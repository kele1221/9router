// Some thinking-mode providers (DeepSeek, Kimi, MiniMax, Console Go, ...) require the
// assistant's reasoning to be echoed back on follow-up requests. Clients in OpenAI
// format don't send it, so we inject a non-empty placeholder to satisfy upstream
// validation ("The `reasoning_text` in the thinking mode must be passed back to the
// API." — opencode-go). Field name comes from registry transport.reasoningInject.fields.
import { PROVIDERS } from "../config/providers.js";
import { RESPONSES_ITEM } from "../translator/schema/index.js";

const PLACEHOLDER = " ";

// Default echo fields for providers that only need the OpenAI-compatible field.
const DEFAULT_FIELDS = ["reasoning_content"];

// Provider-level rules derive from registry transport.reasoningInject (single source)
const providerRuleFor = (provider) => PROVIDERS[provider]?.reasoningInject;

// Model-level rules: matched by predicate against model id
const MODEL_RULES = [
  { match: m => /^kimi-/i.test(m || ""), scope: "toolCalls" },
  { match: m => /deepseek/i.test(m || ""), scope: "all" }
];

const DEEPSEEK_V4_PRO = "deepseek-v4-pro";
const DEEPSEEK_V4_PRO_ALIASES = {
  [`${DEEPSEEK_V4_PRO}-max`]: {
    thinkingType: "enabled",
    reasoningEffort: "max"
  },
  [`${DEEPSEEK_V4_PRO}-none`]: {
    thinkingType: "disabled",
    reasoningEffort: null
  }
};

function shouldInject(message, scope) {
  if (message?.role !== "assistant") return false;
  if (scope === "toolCalls") return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return true;
}

function isAssistantMessageItem(item) {
  return Boolean(
    item && typeof item === "object" &&
    (item.type === RESPONSES_ITEM.MESSAGE || item.role) &&
    item.role === "assistant"
  );
}

// Fill every declared echo field with the placeholder when it is empty/absent.
// Returns a new message when anything changed, else null.
function fillMissingFields(message, fields) {
  let changed = false;
  let next = message;
  for (const field of fields) {
    const value = next[field];
    if (typeof value !== "string" || value.length === 0) {
      next = { ...next, [field]: PLACEHOLDER };
      changed = true;
    }
  }
  return changed ? next : null;
}

// OpenAI Responses shape ({model, input:[...]}): Console Go's /v1/responses demands
// the assistant's previous reasoning re-sent as a top-level `reasoning` ITEM
// (a `reasoning` CONTENT part is rejected — "unknown variant `reasoning`"). Insert
// a placeholder reasoning item right after each assistant message that doesn't
// already have one following it.
function injectResponsesReasoningItems(body) {
  const input = [];
  let inserted = 0;
  for (let i = 0; i < body.input.length; i++) {
    const item = body.input[i];
    input.push(item);
    if (!isAssistantMessageItem(item)) continue;
    const next = body.input[i + 1];
    if (next && next.type === RESPONSES_ITEM.REASONING) continue;
    input.push({
      type: RESPONSES_ITEM.REASONING,
      summary: [{ type: "summary_text", text: PLACEHOLDER }],
    });
    inserted += 1;
  }
  if (inserted > 0) {
    console.log(`[REASON-ECHO] injected ${inserted} responses reasoning item(s)`);
  }
  return inserted > 0 ? { ...body, input } : body;
}

function applyRule(body, rule) {
  if (!rule || (!body?.messages && !body?.input)) return body;
  const fields = Array.isArray(rule.fields) && rule.fields.length ? rule.fields : DEFAULT_FIELDS;
  let injected = 0;

  if (Array.isArray(body.input)) {
    return injectResponsesReasoningItems(body);
  }

  if (Array.isArray(body.messages)) {
    const messages = body.messages.map((message) => {
      if (!shouldInject(message, rule.scope)) return message;
      const next = fillMissingFields(message, fields);
      if (next) {
        injected += 1;
        return next;
      }
      return message;
    });
    if (injected > 0) {
      console.log(`[REASON-ECHO] filled ${injected} chat assistant msg(s) fields=${fields.join(",")}`);
    }
    return { ...body, messages };
  }

  return body;
}

function applyDeepSeekV4ProAlias({ provider, model, body }) {
  const alias = DEEPSEEK_V4_PRO_ALIASES[model];
  if (provider !== "deepseek" || !alias || !body) return body;

  const nextBody = {
    ...body,
    model: DEEPSEEK_V4_PRO,
    extra_body: {
      ...(body.extra_body || {}),
      thinking: {
        ...(body.extra_body?.thinking || {}),
        type: alias.thinkingType
      }
    }
  };

  if (alias.reasoningEffort) {
    nextBody.reasoning_effort = alias.reasoningEffort;
  } else {
    delete nextBody.reasoning_effort;
  }

  return nextBody;
}

const NON_OPENAI_FORMATS = new Set(["claude", "openai-response", "gemini", "kiro", "cursor", "ollama", "commandcode", "vertex", "antigravity", "gemini-cli", "codex"]);

export function injectReasoningContent({ provider, model, body, format = null }) {
  const providerRule = providerRuleFor(provider);
  const modelRule = MODEL_RULES.find(r => r.match(model));
  const rule = providerRule || modelRule;

  const nextBody = applyDeepSeekV4ProAlias({ provider, model, body });

  // Reasoning echo is transport-specific:
  // - openai (chat completions)   → fill reasoning_content/reasoning_text fields
  // - openai-responses (/v1/responses) → insert top-level `reasoning` items
  // - any other format (claude, gemini, ...) or unknown → never touched
  // - no format hint (legacy callers) → chat-field behavior only
  if (!rule) return nextBody;
  if (format === "openai-responses") return applyRule(nextBody, rule);
  if (format && NON_OPENAI_FORMATS.has(format)) return nextBody;
  return applyRule(nextBody, rule);
}
