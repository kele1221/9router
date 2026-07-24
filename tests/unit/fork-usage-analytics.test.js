import { describe, expect, it } from "vitest";

describe("fork usage analytics", () => {
  it("builds chart series from existing usage statistics", async () => {
    const { buildUsageAnalytics } = await import("../../src/lib/fork/usageAnalytics.js");
    const stats = {
      totalPromptTokens: 1000,
      totalCachedTokens: 250,
      totalCompletionTokens: 500,
      byModel: {
        alpha: { rawModel: "alpha", provider: "dashscope", requests: 9, promptTokens: 500, completionTokens: 200, cost: 1.2 },
        beta: { rawModel: "beta", provider: "anthropic", requests: 4, promptTokens: 300, completionTokens: 200, cost: 0.8 },
        gamma: { rawModel: "gamma", provider: "dashscope", requests: 2, promptTokens: 200, completionTokens: 100, cost: 0.4 },
      },
      byProvider: {
        dashscope: { requests: 11, promptTokens: 700, completionTokens: 300, cost: 1.6 },
        anthropic: { requests: 4, promptTokens: 300, completionTokens: 200, cost: 0.8 },
      },
      byApiKey: {
        first: { keyName: "Claude CN", requests: 3, promptTokens: 300, completionTokens: 100 },
        second: { keyName: "Claude CN", requests: 2, promptTokens: 100, completionTokens: 50 },
        third: { keyName: "Codex", requests: 7, promptTokens: 350, completionTokens: 200 },
      },
    };

    expect(buildUsageAnalytics(stats, { limit: 2 })).toEqual({
      modelRequests: [
        { name: "alpha", provider: "dashscope", requests: 9 },
        { name: "beta", provider: "anthropic", requests: 4 },
      ],
      providerTokens: [
        { name: "dashscope", value: 1000, cost: 1.6 },
        { name: "anthropic", value: 500, cost: 0.8 },
      ],
      tokenComposition: [
        { name: "Non-cached input", value: 750 },
        { name: "Cached input", value: 250 },
        { name: "Output", value: 500 },
      ],
      apiKeyUsage: [
        { name: "Codex", requests: 7, tokens: 550 },
        { name: "Claude CN", requests: 5, tokens: 550 },
      ],
    });
  });

  it("returns empty chart series for missing usage data", async () => {
    const { buildUsageAnalytics } = await import("../../src/lib/fork/usageAnalytics.js");

    expect(buildUsageAnalytics(null)).toEqual({
      modelRequests: [],
      providerTokens: [],
      tokenComposition: [],
      apiKeyUsage: [],
    });
  });
});
