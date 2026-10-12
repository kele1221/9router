// Registry alignment with upstream. Both failures below were found by probing the
// real provider APIs — the mismatch is what produced the reported HTTP 400 (a
// renamed DeepSeek model id) and the HTTP 404s on ClinePass.
import { describe, expect, it } from "vitest";

import { getModelUpstreamId, getProviderModels } from "../../open-sse/config/providerModels.js";

describe("DeepSeek registry maps local ids onto upstream ids", () => {
  it("sends the renamed GA id for deepseek-v4.1-flash", async () => {
    // Upstream: GET https://api.deepseek.com/models returns only
    // `deepseek-flash` and `deepseek-v4-pro`; posting `deepseek-v4.1-flash` is
    // rejected with 400 "The supported API model names are deepseek-flash,
    // deepseek-v4-pro, but you passed deepseek-v4.1-flash."
    expect(getModelUpstreamId("deepseek", "deepseek-v4.1-flash")).toBe("deepseek-flash");
  });

  it("preserves the thinking-effort suffix while remapping", async () => {
    expect(getModelUpstreamId("deepseek", "deepseek-v4.1-flash(max)")).toBe("deepseek-flash(max)");
  });

  it("leaves already-valid ids untouched", () => {
    expect(getModelUpstreamId("deepseek", "deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(getModelUpstreamId("deepseek", "deepseek-chat")).toBe("deepseek-chat");
    expect(getModelUpstreamId("deepseek", "deepseek-reasoner")).toBe("deepseek-reasoner");
  });

  it("keeps the local id in the registry so existing combos still resolve", () => {
    const ids = getProviderModels("deepseek").map((m) => m.id);

    expect(ids).toContain("deepseek-v4.1-flash");
  });
});

describe("ClinePass registry matches the live cline-pass/* namespace", () => {
  const ids = getProviderModels("clinepass").map((m) => m.id);

  it("drops the ids upstream answers 404 for", () => {
    // All four answered {"error":"model not found","success":false} on live probes.
    for (const dead of [
      "cline-pass/glm-5.2",
      "cline-pass/kimi-k2.7-code",
      "cline-pass/kimi-k2.6",
      "cline-pass/deepseek-v4-flash",
    ]) {
      expect(ids).not.toContain(dead);
    }
  });

  it("includes the id the local combo config actually calls", () => {
    expect(ids).toContain("cline-pass/deepseek-v4.1-flash");
  });

  it("lists only verified-live ids", () => {
    // Every entry below was probed 200 upstream (2026-10-12).
    expect(ids.sort()).toEqual([
      "cline-pass/deepseek-v4-pro",
      "cline-pass/deepseek-v4.1-flash",
      "cline-pass/glm-5.3",
      "cline-pass/glm-5.3-flash",
      "cline-pass/kimi-k3",
      "cline-pass/mimo-v2.5",
      "cline-pass/mimo-v2.5-pro",
      "cline-pass/mimo-v2.6-flash",
      "cline-pass/mimo-v2.6-pro",
      "cline-pass/minimax-m3",
      "cline-pass/qwen3.7-max",
      "cline-pass/qwen3.7-plus",
      "cline-pass/qwen3.8-max",
    ]);
  });
});
