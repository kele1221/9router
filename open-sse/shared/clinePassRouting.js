const MAX_UPSTREAMS = 8;
const UPSTREAM_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Normalize one ClinePass model's server-owned upstream pin.
 * Invalid settings fail closed (no pin) rather than leaking a partial allow-list.
 */
export function normalizeClinePassPin(pin) {
  if (!pin || typeof pin !== "object") return null;
  const mode = pin.mode === "preferred" ? "preferred" : "strict";
  const upstreams = [...new Set(
    (Array.isArray(pin.upstreams) ? pin.upstreams : [])
      .map((name) => String(name ?? "").trim())
      .filter((name) => name.length > 0),
  )];
  if (upstreams.length === 0 || upstreams.length > MAX_UPSTREAMS) return null;
  if (!upstreams.every((name) => UPSTREAM_NAME_RE.test(name))) return null;
  return { mode, upstreams };
}

/**
 * Apply a ClinePass upstream pin to the final OpenAI Chat body.
 *
 * Cline may execute a model through either OpenRouter's direct pipeline
 * (`provider.*`) or Vercel AI Gateway's planner (`providerOptions.gateway.*`).
 * Writing both forms keeps the pin effective if that pipeline changes.
 */
export function applyClinePassRouting({ provider, body, pin }) {
  if (provider !== "clinepass" || !body || typeof body !== "object") return body;
  const normalized = normalizeClinePassPin(pin);
  if (!normalized) return body;

  const existingProvider = body.provider && typeof body.provider === "object" && !Array.isArray(body.provider)
    ? body.provider
    : {};
  const existingOptions = body.providerOptions && typeof body.providerOptions === "object" && !Array.isArray(body.providerOptions)
    ? body.providerOptions
    : {};
  const existingGateway = existingOptions.gateway && typeof existingOptions.gateway === "object" && !Array.isArray(existingOptions.gateway)
    ? existingOptions.gateway
    : {};

  const routeField = normalized.mode === "strict" ? "only" : "order";
  const sessionId = existingProvider.session_id || existingGateway.session_id;
  const sharedSessionId = typeof sessionId === "string" && sessionId
    ? { session_id: sessionId }
    : {};
  return {
    ...body,
    provider: {
      ...existingProvider,
      [routeField]: normalized.upstreams,
      ...sharedSessionId,
    },
    providerOptions: {
      ...existingOptions,
      gateway: {
        ...existingGateway,
        [routeField]: normalized.upstreams,
        // Keep the two pipeline spellings on one fallback pool when the
        // caller already has a gateway session; otherwise Cline evaluates
        // two differently-keyed arrangements for the same request.
        ...sharedSessionId,
      },
    },
  };
}

/**
 * Read the provider that actually served a Cline response.
 * HTTP 200 is not routing evidence.
 */
export function extractClinePassRouting(json) {
  if (!json || typeof json !== "object") return null;
  const payload = json.data && typeof json.data === "object" ? json.data : json;
  const routing = payload?.choices?.[0]?.message?.provider_metadata?.gateway?.routing
    ?? payload?.provider_metadata?.gateway?.routing
    ?? null;
  // Streaming Cline chunks may place metadata inside their delta rather than
  // a completed message. Read it before the generic metadata-only filter drops
  // the frame.
  const deltaRouting = payload?.choices?.[0]?.delta?.provider_metadata?.gateway?.routing;
  const actual = routing?.finalProvider
    ?? deltaRouting?.finalProvider
    ?? (typeof payload?.provider === "string" ? payload.provider : null);
  if (typeof actual !== "string" || actual.trim() === "") return null;
  return actual.trim().slice(0, 120);
}

/** Compare channel spellings such as `DeepSeek` and `deepseek`. */
export function upstreamMatches(expected, actual) {
  const want = normalizeName(expected);
  const got = normalizeName(actual);
  return want.length > 0 && got.length > 0 && want === got;
}

/** Build the compact request-detail observation shown in Usage → Details. */
export function buildClinePassUpstreamObservation(expected, actual) {
  if (typeof expected !== "string" || expected.trim() === "") return null;
  const observed = typeof actual === "string" && actual.trim() !== "";
  return {
    expected: expected.trim().slice(0, 120),
    actual: observed ? actual.trim().slice(0, 120) : null,
    observed,
    match: observed ? (upstreamMatches(expected, actual) ? "adopted" : "not-adopted") : "unverified",
  };
}

/** Update one request's mutable observation from a streamed or non-streamed frame. */
export function observeClinePassRouting(observation, json) {
  if (!observation) return observation;
  const actual = extractClinePassRouting(json);
  if (!actual) return observation;
  observation.actual = actual;
  observation.observed = true;
  observation.match = upstreamMatches(observation.expected, actual) ? "adopted" : "not-adopted";
  return observation;
}
