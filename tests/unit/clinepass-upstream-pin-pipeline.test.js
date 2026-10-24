import { describe, it, expect } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { applyClinePassRouting } from "../../open-sse/shared/clinePassRouting.js";

const PIN = { mode: "strict", upstreams: ["deepseek"] };

describe("ClinePass pin cross-format boundary", () => {
  it("covers a Claude Messages request after translation", () => {
    const claude = {
      model: "cline-pass/deepseek-v4.1-flash",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    };
    const translated = translateRequest(
      "claude",
      "openai",
      "cline-pass/deepseek-v4.1-flash",
      claude,
      false,
    );
    const routed = applyClinePassRouting({ provider: "clinepass", body: translated, pin: PIN });
    expect(routed.provider.only).toEqual(["deepseek"]);
    expect(routed.providerOptions.gateway.only).toEqual(["deepseek"]);
  });

  it("covers a Codex Responses request after translation", () => {
    const responses = {
      model: "cline-pass/deepseek-v4.1-flash",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      stream: true,
    };
    const translated = translateRequest(
      "openai-responses",
      "openai",
      "cline-pass/deepseek-v4.1-flash",
      responses,
      false,
    );
    const routed = applyClinePassRouting({ provider: "clinepass", body: translated, pin: PIN });
    expect(routed.provider.only).toEqual(["deepseek"]);
    expect(routed.providerOptions.gateway.only).toEqual(["deepseek"]);
  });

  it("covers OpenAI Chat and leaves direct DeepSeek untouched", () => {
    const chat = {
      model: "cline-pass/deepseek-v4.1-flash",
      messages: [{ role: "user", content: "hi" }],
    };
    const routed = applyClinePassRouting({ provider: "clinepass", body: chat, pin: PIN });
    expect(routed.provider.only).toEqual(["deepseek"]);
    expect(routed.providerOptions.gateway.only).toEqual(["deepseek"]);

    const direct = { model: "deepseek-v4-pro", messages: [] };
    expect(applyClinePassRouting({ provider: "deepseek", body: direct, pin: PIN })).toBe(direct);
  });
});
