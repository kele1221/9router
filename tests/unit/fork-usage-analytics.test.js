import { describe, expect, it } from "vitest";

describe("fork usage dashboard analytics", () => {
  it("builds the five reference-dashboard datasets from 9Router records", async () => {
    const { buildUsageAnalytics } = await import("../../src/lib/fork/usageAnalytics.js");
    const result = buildUsageAnalytics({
      usageRows: [
        {
          timestamp: "2026-07-24T11:15:00.000Z",
          model: "alpha",
          apiKey: "key-a",
          promptTokens: 100,
          completionTokens: 50,
          status: "success",
          tokens: { cached_tokens: 20 },
        },
        {
          timestamp: "2026-07-24T11:45:00.000Z",
          model: "alpha",
          apiKey: "key-a",
          promptTokens: 200,
          completionTokens: 100,
          status: "error",
          tokens: { cache_read_input_tokens: 50 },
        },
        {
          timestamp: "2026-07-24T10:10:00.000Z",
          model: "beta",
          apiKey: "key-b",
          promptTokens: 50,
          completionTokens: 25,
          status: "success",
          tokens: {},
        },
        {
          timestamp: "2026-07-20T10:10:00.000Z",
          model: "too-old",
          apiKey: "key-a",
          promptTokens: 999,
          completionTokens: 999,
          status: "success",
          tokens: {},
        },
      ],
      detailRows: [
        { timestamp: "2026-07-24T11:05:00.000Z", model: "alpha", status: "success", latency: { total: 1000 } },
        { timestamp: "2026-07-24T11:35:00.000Z", model: "alpha", status: "error", latency: { total: 3000 } },
        { timestamp: "2026-07-24T10:15:00.000Z", model: "beta", status: "success", latency: { total: 500 } },
        { timestamp: "2026-07-20T10:15:00.000Z", model: "too-old", status: "error", latency: { total: 9000 } },
      ],
      apiKeyNames: { "key-a": "Claude CN", "key-b": "Codex" },
    }, {
      period: "24h",
      now: new Date("2026-07-24T12:00:00.000Z"),
      limit: 5,
    });

    expect(result.modelStats).toEqual([
      {
        model: "alpha",
        totalRequests: 3,
        totalErrors: 1,
        errorRate: 33.3,
        inputTokens: 300,
        outputTokens: 150,
        cachedTokens: 70,
        avgLatencyMs: 2000,
      },
      {
        model: "beta",
        totalRequests: 1,
        totalErrors: 0,
        errorRate: 0,
        inputTokens: 50,
        outputTokens: 25,
        cachedTokens: 0,
        avgLatencyMs: 500,
      },
    ]);
    expect(result.tokenDistribution).toEqual([
      { name: "alpha", value: 450 },
      { name: "beta", value: 75 },
    ]);
    expect(result.apiKeyStats).toEqual([
      { name: "Claude CN", totalRequests: 2, totalErrors: 1 },
      { name: "Codex", totalRequests: 1, totalErrors: 0 },
    ]);
    expect(result.requestTrend).toHaveLength(24);
    expect(result.requestTrend.reduce((sum, bucket) => sum + bucket.alpha, 0)).toBe(3);
    expect(result.requestTrend.reduce((sum, bucket) => sum + bucket.beta, 0)).toBe(1);
    expect(result.coverage).toEqual({ requestSamples: 3, oldestRequestAt: "2026-07-24T10:15:00.000Z" });
  });

  it("returns empty chart datasets when no records are available", async () => {
    const { buildUsageAnalytics } = await import("../../src/lib/fork/usageAnalytics.js");

    expect(buildUsageAnalytics({}, {
      period: "24h",
      now: new Date("2026-07-24T12:00:00.000Z"),
    })).toEqual({
      modelStats: [],
      requestTrend: [],
      tokenDistribution: [],
      apiKeyStats: [],
      coverage: { requestSamples: 0, oldestRequestAt: null },
    });
  });

  it("limits only the trend to five models while keeping the other reference charts complete", async () => {
    const { buildUsageAnalytics } = await import("../../src/lib/fork/usageAnalytics.js");
    const usageRows = Array.from({ length: 6 }, (_, index) => ({
      timestamp: `2026-07-24T1${index}:10:00.000Z`,
      model: `model-${index + 1}`,
      apiKey: `key-${index + 1}`,
      promptTokens: 100 - index,
      completionTokens: 10,
      status: "success",
      tokens: {},
    }));

    const result = buildUsageAnalytics({ usageRows }, {
      period: "24h",
      now: new Date("2026-07-24T18:00:00.000Z"),
      limit: 5,
    });

    expect(result.modelStats).toHaveLength(6);
    expect(result.tokenDistribution).toHaveLength(6);
    expect(result.apiKeyStats).toHaveLength(6);
    expect(Object.keys(result.requestTrend[0]).filter((key) => key !== "timestamp")).toHaveLength(5);
  });
});
