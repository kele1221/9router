// Some thinking-mode providers (DeepSeek, Kimi, MiniMax, Console Go, ...) require the
// assistant's reasoning to be echoed back on follow-up requests. Clients in OpenAI
// format don't send it, so we inject a non-empty placeholder to satisfy upstream
// validation ("The `reasoning_text` in the thinking mode must be passed back to the
// API." — opencode-go). Field name comes from registry transport.reasoningInject.fields.
import { PROVIDERS } from "../config/providers.js";

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

function applyRule(body, rule) {
  if (!rule || (!body?.messages && !body?.input)) return body;
  const fields = Array.isArray(rule.fields) && rule.fields.length ? rule.fields : DEFAULT_FIELDS;
  let injected = 0;

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

  // NOTE: Responses-shape requests ({input:[...]}, e.g. opencode-go /v1/responses)
  // must NOT get a `reasoning` content part injected. The upstream deserializer
  // rejects it outright ("unknown variant `reasoning`, expected one of
  // `input_text`, `output_text`, `input_image`, `input_file`"). Reasoning is
  // output-only there: echo it via chat-shape fields (reasoning_content/
  // reasoning_text) or not at all.
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

export function injectReasoningContent({ provider, model, body, format = null }) {
  const providerRule = providerRuleFor(provider);
  const modelRule = MODEL_RULES.find(r => r.match(model));
  const rule = providerRule || modelRule;

  // Reasoning echo fields (reasoning_content / reasoning_text) are OpenAI
  // chat-completions concepts. When the caller knows the upstream transport
  // format, only run the rule for OpenAI chat — Claude (/v1/messages) and
  // OpenAI Responses (/v1/responses) bodies must never get these fields or
  // their reasoning content parts (Console Go rejects both with 400).
  if (rule && format && format !== "openai") return body;

  const nextBody = applyDeepSeekV4ProAlias({ provider, model, body });
  return applyRule(nextBody, rule);
}
