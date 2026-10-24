import { getCapabilitiesForModel } from "../../providers/capabilities.js";

// Strip request params a given provider/model rejects upstream (e.g. HTTP 400).
// Config-driven: add a rule instead of scattering `delete body.x` across executors.

// Each rule: optional provider, regex match on model, list of params to drop.
// A param is removed only when it is present (!== undefined).
const STRIP_RULES = [
  // All Claude models: temperature deprecated/rejected upstream (Anthropic 400). #1748
  { match: /claude/i, drop: ["temperature"] },
  // GitHub Copilot gpt-5.4: temperature unsupported.
  { provider: "github", match: /gpt-5\.4/i, drop: ["temperature"] },
  // GitHub Copilot Claude (except opus/sonnet 4.6): thinking + reasoning_effort rejected. #713
  { provider: "github", match: (m) => /claude/i.test(m) && !/claude.*(opus|sonnet).*4\.6/i.test(m), drop: ["thinking", "reasoning_effort"] },
  // Cloudflare Workers AI: content must be plain string, rejects OpenAI content-part array (#1926)
  { provider: "cloudflare-ai", flattenContent: true },
  { provider: "volcengine-ark", match: /glm-5/i, clampToModelMaxOutput: true },
  // VolcEngine Ark caps the Kimi family at max_tokens <= 32768, but the model's
  // advertised ceiling is far higher (Kimi-K2.7-Code resolves to maxOutput 262144),
  // so clampToModelMaxOutput alone leaves it uncapped and the request 400s with
  // "integer above maximum value, expected <= 32768". Pin an explicit endpoint cap;
  // min() with the model ceiling still applies if a variant's own limit is lower.
  { provider: "volcengine-ark", match: /kimi/i, maxOutputCap: 32768, clampToModelMaxOutput: true },
  // Strict OpenAI-compatible validators reject unknown assistant-message fields.
  // Clients that talk to reasoning models (e.g. Hermes) echo the prior turn's
  // reasoning back on every assistant message; Groq answers 400 and Mistral 422
  // ("extra_forbidden") on it, which knocks these providers out of every
  // multi-turn combo. Providers that *require* the field (DeepSeek, Kimi) are
  // handled by reasoningContentInjector and are not listed here.
  { provider: "groq", dropMessageFields: ["reasoning_content", "reasoning", "reasoning_details"] },
  { provider: "mistral", dropMessageFields: ["reasoning_content", "reasoning", "reasoning_details"] },
  { provider: "cerebras", dropMessageFields: ["reasoning_content", "reasoning", "reasoning_details"] },
];

// Reasoning models spend output tokens on thinking BEFORE emitting any content, so
// a max_tokens smaller than the thinking run streams an empty `content` and the
// upstream reports that as an error rather than as a truncation.
//
// ClinePass is the sharpest case: `cline-pass/deepseek-v4.1-flash` answers
// HTTP 500 {"error":"empty response content","success":false} for max_tokens <= 16
// and 200 from 24 upward (probed live). The engine then reads that 500 as a
// transient server fault — it retries, locks the only connection for the transient
// cooldown, and burns a combo slot. None of that is a server fault: the caller
// simply asked for fewer tokens than the model needs before it can start answering.
//
// Raising the floor (never lowering a larger caller-supplied value) keeps the
// request valid instead of converting it into a fake outage. A caller asking for
// 8 tokens still gets a short answer — it just also gets the thinking overhead it
// did not account for.
const MIN_OUTPUT_RULES = [
  // DeepSeek V4.x on ClinePass: the thinking run routinely exceeds 16 tokens.
  { provider: "clinepass", match: /deepseek/i, minTokens: 256 },
];

// Test a rule's match (regex or predicate) against the model id.
function matches(rule, model) {
  if (!rule.match) return true;
  return typeof rule.match === "function" ? rule.match(model) : rule.match.test(model);
}

function clampNumber(body, key, ceiling) {
  if (typeof body[key] === "number" && Number.isFinite(body[key]) && body[key] > ceiling) {
    body[key] = ceiling;
  }
}

// Lift a token-limit field up to a floor, never down. `undefined` stays undefined so
// we do not invent a limit for a caller that deliberately omitted one (some upstreams
// treat an absent max_tokens differently from an explicit value).
function raiseNumber(body, key, floor) {
  if (typeof body[key] === "number" && Number.isFinite(body[key]) && body[key] < floor) {
    body[key] = floor;
  }
}

// Remove unsupported params from body in place; returns body.
export function stripUnsupportedParams(provider, model, body) {
  if (!model || !body || typeof body !== "object") return body;
  for (const rule of STRIP_RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (!matches(rule, model)) continue;
    for (const key of rule.drop || []) {
      if (body[key] !== undefined) delete body[key];
    }
    // Per-message field drop (assistant turns only — that is where clients replay reasoning).
    if (Array.isArray(rule.dropMessageFields) && Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!msg || msg.role !== "assistant") continue;
        for (const key of rule.dropMessageFields) {
          if (msg[key] !== undefined) delete msg[key];
        }
      }
    }
    // CF Workers AI oneOf root schema only accepts content as plain string (#1926)
    if (rule.flattenContent && Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (msg && Array.isArray(msg.content)) {
          msg.content = msg.content
            .map(b => (b?.type === "text" && typeof b.text === "string") ? b.text : "")
            .join("");
        }
      }
    }
    if (rule.clampToModelMaxOutput || Number.isFinite(rule.maxOutputCap)) {
      const modelCeiling = getCapabilitiesForModel(provider, model).maxOutput;
      const candidates = [];
      if (rule.clampToModelMaxOutput && Number.isFinite(modelCeiling) && modelCeiling > 0) {
        candidates.push(modelCeiling);
      }
      if (Number.isFinite(rule.maxOutputCap) && rule.maxOutputCap > 0) {
        candidates.push(rule.maxOutputCap);
      }
      if (candidates.length > 0) {
        const ceiling = Math.min(...candidates);
        clampNumber(body, "max_tokens", ceiling);
        clampNumber(body, "max_completion_tokens", ceiling);
        clampNumber(body, "max_output_tokens", ceiling);
      }
    }
  }

  // Raise (never lower) the output-token floor for reasoning models. Applied after
  // the cap rules so a model whose own ceiling is below the floor still wins.
  for (const rule of MIN_OUTPUT_RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (!matches(rule, model)) continue;
    raiseNumber(body, "max_tokens", rule.minTokens);
    raiseNumber(body, "max_completion_tokens", rule.minTokens);
    raiseNumber(body, "max_output_tokens", rule.minTokens);
  }
  return body;
}
