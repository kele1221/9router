import { describe, it, expect } from "vitest";

import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("stripUnsupportedParams", () => {
  it("flattens Cloudflare AI OpenAI content-part arrays", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello " },
            { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
            { type: "text", text: "world" },
          ],
        },
      ],
    };

    expect(() => stripUnsupportedParams("cloudflare-ai", "@cf/meta/llama-3.1-8b-instruct", body)).not.toThrow();
    expect(body.messages[0].content).toBe("hello world");
  });

  it("still drops unsupported GitHub model params", () => {
    const body = { temperature: 0.7, top_p: 1 };

    stripUnsupportedParams("github", "gpt-5.4", body);

    expect(body).toEqual({ top_p: 1 });
  });

  it("clamps VolcEngine Ark GLM max token fields to the model output ceiling", () => {
    const body = {
      max_tokens: 131072,
      max_completion_tokens: 131072,
      max_output_tokens: 131072,
    };

    stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);

    expect(body).toEqual({
      max_tokens: 128000,
      max_completion_tokens: 128000,
      max_output_tokens: 128000,
    });
  });

  it("keeps VolcEngine Ark GLM max tokens when already under the ceiling", () => {
    const body = { max_tokens: 64000 };

    stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);

    expect(body.max_tokens).toBe(64000);
  });

  it("drops replayed reasoning fields from assistant messages for strict providers", () => {
    const makeBody = () => ({
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "hello",
          reasoning_content: "thinking...",
          reasoning: "thinking...",
          reasoning_details: [{ text: "thinking..." }],
          tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }],
        },
        { role: "user", content: "again", reasoning_content: "user-side field stays" },
      ],
    });

    for (const [provider, model] of [
      ["groq", "openai/gpt-oss-120b"],
      ["mistral", "codestral-latest"],
      ["cerebras", "gpt-oss-120b"],
    ]) {
      const body = makeBody();
      stripUnsupportedParams(provider, model, body);
      expect(body.messages[1]).toEqual({
        role: "assistant",
        content: "hello",
        tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }],
      });
      // only assistant turns are touched
      expect(body.messages[2].reasoning_content).toBe("user-side field stays");
    }
  });

  it("leaves reasoning fields alone for providers that accept or require them", () => {
    const body = {
      messages: [{ role: "assistant", content: "hello", reasoning_content: "thinking..." }],
    };

    stripUnsupportedParams("deepseek", "deepseek-reasoner", body);
    stripUnsupportedParams("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free", body);

    expect(body.messages[0].reasoning_content).toBe("thinking...");
  });

  // Reasoning models spend output tokens on thinking BEFORE emitting content; a
  // max_tokens below the thinking run yields an empty `content` that some upstreams
  // report as an error (clinepass deepseek-v4.1-flash → HTTP 500 "empty response
  // content"). The floor lifts a too-small caller value without ever lowering a
  // larger one, and without inventing a value the caller deliberately omitted.
  describe("MIN_OUTPUT_RULES floor (clinepass deepseek)", () => {
    it("raises a below-floor max_tokens up to the minimum", () => {
      const body = { max_tokens: 8 };

      stripUnsupportedParams("clinepass", "deepseek-v4.1-flash", body);

      expect(body.max_tokens).toBe(256);
    });

    it("never lowers a max_tokens already above the floor", () => {
      const body = { max_tokens: 4096 };

      stripUnsupportedParams("clinepass", "deepseek-v4.1-flash", body);

      expect(body.max_tokens).toBe(4096);
    });

    it("does not invent a limit when the caller omitted the field", () => {
      const body = { temperature: 0.5 };

      stripUnsupportedParams("clinepass", "deepseek-v4.1-flash", body);

      expect(body.max_tokens).toBeUndefined();
    });

    it("raises max_completion_tokens and max_output_tokens too", () => {
      const body = { max_completion_tokens: 16, max_output_tokens: 1 };

      stripUnsupportedParams("clinepass", "deepseek-v4.1-flash", body);

      expect(body.max_completion_tokens).toBe(256);
      expect(body.max_output_tokens).toBe(256);
    });

    it("does not raise on a non-clinepass provider even for deepseek models", () => {
      const body = { max_tokens: 8 };

      stripUnsupportedParams("deepseek", "deepseek-v4.1-flash", body);

      expect(body.max_tokens).toBe(8);
    });

    it("does not raise on clinepass for a non-deepseek model", () => {
      const body = { max_tokens: 8 };

      stripUnsupportedParams("clinepass", "glm-5.3-flash", body);

      expect(body.max_tokens).toBe(8);
    });
  });
});
