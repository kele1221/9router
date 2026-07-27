// OpenAI-compatible error types mapping (client-facing)
export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" },
};

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout",
};

// Exponential backoff config for rate limits
export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15,
};

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Hard cap for provider-reported rate limit cooldown (e.g. codex resets_at can be 5-6h)
export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Runtime-overridable markers, rules, and config
// The app bootstrap (src/lib/fork/errorRulesConfig.js → boostrap) calls
// setRuntimeErrorConfig() at startup and on reload. Consumers that need to
// reflect live changes MUST use the getter functions below.
// ---------------------------------------------------------------------------

let _runtimeMarkers = null;
let _runtimeRules = null;

// Some OpenAI-compatible gateways return HTTP 400 while the structured error
// correctly identifies a rate limit. Normalize these markers before fallback
// and model-lock decisions so the request follows the 429 backoff path.
// Keep the singular export for compatibility with existing integrations.
export const RATE_LIMIT_ERROR_MARKER = "rate_limit_exceeded";
export const RATE_LIMIT_ERROR_MARKERS = Object.freeze([
  RATE_LIMIT_ERROR_MARKER,
  "rate_limit_error",
]);

export function isRateLimitErrorMarker(value) {
  const markers = _runtimeMarkers || RATE_LIMIT_ERROR_MARKERS;
  return typeof value === "string" && markers.includes(value.trim().toLowerCase());
}

/** Returns the active rate-limit markers (runtime override or default). */
export function getAllRateLimitMarkers() {
  return _runtimeMarkers || RATE_LIMIT_ERROR_MARKERS;
}

// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
};

/**
 * Unified error classification rules.
 * Checked top-to-bottom: text rules first (by order), then status rules.
 * Each rule: { text?, status?, cooldownMs?, backoff? }
 *   - text: substring match (case-insensitive) on error message
 *   - status: HTTP status code match
 *   - cooldownMs: fixed cooldown duration
 *   - backoff: true = use exponential backoff (rate limit)
 *
 * The array is mutable so setRuntimeErrorConfig() can replace its contents.
 * Consumers that hold a reference at import time see the live mutations.
 */
export const ERROR_RULES = [
  // --- Text-based rules (checked first, order = priority) ---
  { text: "no credentials",           cooldownMs: COOLDOWN.long },
  { text: "request not allowed",      cooldownMs: COOLDOWN.short },
  { text: "improperly formed request", cooldownMs: COOLDOWN.long },
  { text: "rate limit",               backoff: true },
  { text: "too many requests",        backoff: true },
  { text: "quota exceeded",           backoff: true },
  { text: "capacity",                 backoff: true },
  { text: "overloaded",               backoff: true },

  // --- Status-based rules (fallback when text doesn't match) ---
  { status: 401, cooldownMs: COOLDOWN.long },
  { status: 402, cooldownMs: COOLDOWN.long },
  { status: 403, cooldownMs: COOLDOWN.long },
  { status: 404, cooldownMs: COOLDOWN.long },
  { status: 429, backoff: true },
];

// Backward compat: COOLDOWN_MS object (used by index.js re-export)
export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};

/**
 * Replace runtime error rules, markers, and config with values loaded from
 * the local config file. Called by the app bootstrap at startup and on reload.
 *
 * @param {object} config - Parsed from error-rules.local.json
 * @param {string[]} [config.rateLimitMarkers] - Override for rate-limit markers
 * @param {object[]} [config.errorRules] - Override for ERROR_RULES array
 * @param {object}  [config.backoffConfig] - Override for BACKOFF_CONFIG props
 * @param {number}  [config.transientCooldownMs] - Override for TRANSIENT_COOLDOWN_MS
 * @param {number}  [config.maxRateLimitCooldownMs] - Override for MAX_RATE_LIMIT_COOLDOWN_MS
 */
export function setRuntimeErrorConfig(config) {
  if (!config) return;

  if (Array.isArray(config.rateLimitMarkers) && config.rateLimitMarkers.length > 0) {
    _runtimeMarkers = Object.freeze(
      config.rateLimitMarkers.map((m) => m.trim().toLowerCase()).filter(Boolean),
    );
  }

  if (Array.isArray(config.errorRules)) {
    _runtimeRules = config.errorRules;
    // Mutate the exported array in-place so existing import references see the new rules
    ERROR_RULES.splice(0, ERROR_RULES.length, ...config.errorRules);
  }

  if (config.backoffConfig && typeof config.backoffConfig === "object") {
    Object.assign(BACKOFF_CONFIG, config.backoffConfig);
  }

  if (typeof config.transientCooldownMs === "number") {
    // Can't reassign a const, so expose via the exported COOLDOWN_MS object
    COOLDOWN_MS.transient = config.transientCooldownMs;
  }

  if (typeof config.maxRateLimitCooldownMs === "number") {
    // Similarly, expose via a property on the COOLDOWN_MS object
    COOLDOWN_MS.maxRateLimit = config.maxRateLimitCooldownMs;
  }
}

/** Get the active transient cooldown (runtime override or default). */
export function getTransientCooldown() {
  return COOLDOWN_MS.transient || TRANSIENT_COOLDOWN_MS;
}

/** Get the active max rate-limit cooldown (runtime override or default). */
export function getMaxRateLimitCooldown() {
  return COOLDOWN_MS.maxRateLimit || MAX_RATE_LIMIT_COOLDOWN_MS;
}