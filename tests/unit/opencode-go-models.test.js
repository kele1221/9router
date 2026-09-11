import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelSupportedFormats } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

// Chat-only models (no /messages, no /responses support on opencode-go)
const CHAT_ONLY = ["glm-5.3", "glm-5.2", "glm-5.1", "kimi-k2.7-code", "kimi-k2.6", "kimi-k3",
  "deepseek-flash", "longcat-2.0", "mimo-v2.5", "mimo-v2.5-pro", "hy4-preview", "hy3"];
// Models that also expose the Anthropic /messages endpoint
const CLAUDE_CAPABLE = ["minimax-m3", "minimax-m2.7", "minimax-m2.5",
  "qwen3.8-max", "qwen3.8-flash", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus"];
// Models that expose OpenAI chat + Anthropic /messages (NOT /responses):
// Console Go's /v1/responses demands real prior reasoning echoed back for
// thinking-mode continuity, which 9router cannot provide — DeepSeek requests
// from responses-format clients are translated to the chat transport instead.
const DEEPSEEK_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"];
// Models exposed only through the OpenAI /responses endpoint (official endpoint table)
const RESPONSES_ONLY = ["gpt-5.6-luna"];

// Mirror of chatCore's per-model transport guard: use the sourceFormat-matched
// transport only when the model declares support for that sourceFormat.
function pickTransport(provider, sourceFormat, alias, model) {
  const supported = getModelSupportedFormats(alias, model);
  const rt = resolveTransport(provider, sourceFormat);
  return supported?.includes(sourceFormat) ? rt : null;
}

describe("OpenCode Go model catalog", () => {
  it("matches the documented model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((m) => m.id);
    expect(ids).toEqual([
      "deepseek-flash",
      "glm-5.3-flash", "glm-5.3", "glm-5.2", "glm-5.1", "kimi-k2.7-code", "kimi-k2.6", "kimi-k3",
      "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp",
      "longcat-2.0", "mimo-v2.5", "mimo-v2.5-pro",
      "minimax-m3", "minimax-m2.7", "minimax-m2.5",
      "qwen3.8-max", "qwen3.8-flash", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus",
      "hy4-preview", "hy3",
      "grok-4.6", "gpt-5.6-luna",
      "muse-spark-1.2-contributor", "muse-spark-1.3-contributor",
    ]);
  });
});

describe("OpenCode Go per-model supportedFormats", () => {
  it("declares [openai, claude] for MiniMax + Qwen models", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai", "claude"]);
    }
  });

  it("declares [openai, claude] for DeepSeek models (responses dropped: continuity echo impossible)", () => {
    for (const m of DEEPSEEK_MODELS) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai", "claude"]);
    }
  });

  it("declares [openai-responses] only for GPT-5.6 Luna (official endpoint table)", () => {
    for (const m of RESPONSES_ONLY) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai-responses"]);
    }
  });

  it("declares [openai] only for chat-only models (GLM/Kimi/MiMo) → guards /messages routing", () => {
    for (const m of CHAT_ONLY) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai"]);
    }
  });
});

describe("OpenCode Go multi-endpoint transports", () => {
  it("declares a modelsFetcher for the public Go catalog", () => {
    expect(PROVIDER_MEDIA["opencode-go"].modelsFetcher).toEqual({
      url: "https://opencode.ai/zen/go/v1/models",
      type: "opencode-go",
    });
  });

  it("passes through every model from the Go catalog", () => {
    expect(FILTERS["opencode-go"]([
      { id: "glm-5.3" },
      { id: "kimi-k3", name: "Kimi K3" },
    ])).toEqual([
      { id: "glm-5.3", name: "glm-5.3" },
      { id: "kimi-k3", name: "Kimi K3" },
    ]);
  });

  it("declares openai / claude / openai-responses transports", () => {
    const formats = (PROVIDERS["opencode-go"].transports || []).map((t) => t.format);
    expect(formats).toEqual(["openai", "claude", "openai-responses"]);
  });

  it("resolveTransport picks the endpoint matching the client sourceFormat", () => {
    expect(resolveTransport("opencode-go", "claude").baseUrl).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(resolveTransport("opencode-go", "openai-responses").baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
    expect(resolveTransport("opencode-go", "openai").baseUrl).toBe("https://opencode.ai/zen/go/v1/chat/completions");
  });

  it("uses x-api-key + anthropicVersion on the claude transport", () => {
    const t = resolveTransport("opencode-go", "claude");
    expect(t.auth.header).toBe("x-api-key");
    expect(t.auth.anthropicVersion).toBe(true);
  });
});

describe("OpenCode Go per-model transport guard (chatCore logic)", () => {
  it("routes MiniMax/Qwen + claude-format client to /messages", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)?.baseUrl).toBe("https://opencode.ai/zen/go/v1/messages");
    }
  });

  it("does NOT route chat-only models to /messages on a claude-format request", () => {
    for (const m of CHAT_ONLY) {
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)).toBeNull();
    }
  });

  it("does NOT route DeepSeek + responses-format client to /responses (falls back to chat transport)", () => {
    for (const m of DEEPSEEK_MODELS) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)).toBeNull();
    }
  });

  it("routes GPT-5.6 Luna + responses-format client to /responses", () => {
    for (const m of RESPONSES_ONLY) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)?.baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
    }
  });

  it("does NOT route GPT-5.6 Luna to /messages or /chat/completions on other formats", () => {
    for (const m of RESPONSES_ONLY) {
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)).toBeNull();
      expect(pickTransport("opencode-go", "openai", "opencode-go", m)).toBeNull();
    }
  });

  it("routes Muse Spark (responses-only) to /responses, never to /messages", () => {
    for (const m of ["muse-spark-1.2-contributor", "muse-spark-1.3-contributor", "grok-4.6", "gpt-5.6-luna"]) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai-responses"]);
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)?.baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)).toBeNull();
      expect(pickTransport("opencode-go", "openai", "opencode-go", m)).toBeNull();
    }
  });

  it("does NOT route MiniMax (no responses support) to /responses", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)).toBeNull();
    }
  });
});
