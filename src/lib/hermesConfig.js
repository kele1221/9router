const MODEL_BLOCK_RE = /^model:[ \t]*\r?\n((?:[ \t]+.*\r?\n?|[ \t]*\r?\n)*)/m;
const MANAGED_MODEL_KEYS = new Set(["default", "provider", "base_url", "api_key", "context_length"]);

export const HERMES_MIN_CONTEXT_LENGTH = 64_000;

export const HERMES_CONTEXT_PRESETS = [
  { label: "Auto", value: "" },
  { label: "64K", value: "64000" },
  { label: "128K", value: "128000" },
  { label: "200K", value: "200000" },
  { label: "256K", value: "256000" },
  { label: "512K", value: "512000" },
  { label: "1M", value: "1000000" },
];

export class HermesContextLengthError extends Error {
  constructor(message) {
    super(message);
    this.name = "HermesContextLengthError";
  }
}

/**
 * Normalize a Hermes context length input to an integer token count.
 * undefined means "not supplied"; null/empty/auto means "remove override".
 */
export function normalizeHermesContextLength(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === "auto") return null;

    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([km])?$/i);
    if (!match) {
      throw new HermesContextLengthError(
        "contextLength must be a positive token count, such as 128000, 128K, or 1M",
      );
    }

    const amount = Number(match[1]);
    const multiplier = match[2]?.toLowerCase() === "m"
      ? 1_000_000
      : match[2]?.toLowerCase() === "k"
        ? 1_000
        : 1;
    value = amount * multiplier;
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new HermesContextLengthError("contextLength must be a positive safe integer token count");
  }
  if (value < HERMES_MIN_CONTEXT_LENGTH) {
    throw new HermesContextLengthError(
      `contextLength must be at least ${HERMES_MIN_CONTEXT_LENGTH.toLocaleString()} tokens for Hermes Agent`,
    );
  }

  return value;
}

/**
 * Resolve a full Apply request. An omitted override is preserved only when
 * the active model and endpoint are unchanged; switching either returns Auto.
 */
export function resolveHermesContextLength({ value, hasValue, existingModel, model, provider = "custom", baseUrl }) {
  if (hasValue) return normalizeHermesContextLength(value);
  return existingModel?.default === model
    && existingModel?.provider === provider
    && existingModel?.base_url === baseUrl
    ? undefined
    : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getModelBlock(yaml) {
  return yaml.match(MODEL_BLOCK_RE);
}

function getField(body, key) {
  const keyPattern = escapeRegExp(key);
  const match = body.match(new RegExp(`^[ \\t]+${keyPattern}[ \\t]*:[ \\t]*(.*?)\\r?$`, "m"));
  if (!match) return null;

  let value = match[1].trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parse the fields used by the 9Router Hermes integration.
 * Invalid existing context values are exposed as null so the UI can recover
 * through Auto or a valid explicit value instead of crashing status checks.
 */
export function parseHermesModelBlock(yaml) {
  const match = getModelBlock(yaml);
  if (!match) return null;

  const body = match[1] || "";
  const rawContextLength = getField(body, "context_length");
  let contextLength = null;
  if (rawContextLength !== null) {
    try {
      contextLength = normalizeHermesContextLength(rawContextLength);
    } catch {
      contextLength = null;
    }
  }

  return {
    default: getField(body, "default"),
    provider: getField(body, "provider"),
    base_url: getField(body, "base_url"),
    api_key: getField(body, "api_key"),
    context_length: contextLength,
  };
}

function quoteYamlString(value) {
  return JSON.stringify(String(value));
}

function formatModelField(key, value) {
  if (key === "api_key" && value === "${OPENAI_API_KEY}") return value;
  if (key === "context_length") return String(value);
  return quoteYamlString(value);
}

function replaceManagedFields(body, fields) {
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const sourceLines = body.split(/\r?\n/);
  const hadTrailingEmptyLine = sourceLines[sourceLines.length - 1] === "";
  const lines = hadTrailingEmptyLine ? sourceLines.slice(0, -1) : sourceLines.slice();
  const seen = new Set();
  const output = [];

  for (const line of lines) {
    const match = line.match(/^(?<indent>[ \t]+)(?<key>[A-Za-z0-9_-]+)[ \t]*:/);
    const key = match?.groups?.key;

    if (!key || !MANAGED_MODEL_KEYS.has(key)) {
      output.push(line);
      continue;
    }

    // Collapse duplicate managed entries while preserving the first position.
    if (seen.has(key)) continue;
    seen.add(key);

    if (Object.prototype.hasOwnProperty.call(fields, key) && fields[key] !== undefined) {
      if (key === "context_length" && fields[key] === null) continue;
      output.push(`${match.groups.indent}${key}: ${formatModelField(key, fields[key])}`);
    } else {
      output.push(line);
    }
  }

  const missing = [];
  for (const key of ["default", "provider", "base_url", "api_key", "context_length"]) {
    if (!seen.has(key) && Object.prototype.hasOwnProperty.call(fields, key) && fields[key] !== undefined) {
      if (key === "context_length" && fields[key] === null) continue;
      missing.push(`  ${key}: ${formatModelField(key, fields[key])}`);
    }
  }

  const nextLines = [...missing, ...output];
  return `${nextLines.join(newline)}${hadTrailingEmptyLine ? newline : ""}`;
}

function buildModelBlock(fields) {
  const lines = [
    "model:",
    `  default: ${formatModelField("default", fields.default)}`,
    `  provider: ${formatModelField("provider", fields.provider)}`,
    `  base_url: ${formatModelField("base_url", fields.base_url)}`,
    `  api_key: ${formatModelField("api_key", fields.api_key)}`,
  ];
  if (fields.context_length !== undefined && fields.context_length !== null) {
    lines.push(`  context_length: ${formatModelField("context_length", fields.context_length)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Update the 9Router-owned fields in the top-level Hermes model block.
 * context_length is left untouched when omitted, and removed when null.
 */
export function upsertHermesModelBlock(yaml, fields) {
  const match = getModelBlock(yaml);
  if (!match) {
    const block = buildModelBlock(fields);
    return yaml.length > 0 ? `${block}\n${yaml}` : block;
  }

  const nextBlock = `model:\n${replaceManagedFields(match[1] || "", fields)}`;
  return yaml.replace(MODEL_BLOCK_RE, nextBlock);
}

export function removeHermesModelBlock(yaml) {
  return yaml.replace(MODEL_BLOCK_RE, "").replace(/^\n+/, "");
}
