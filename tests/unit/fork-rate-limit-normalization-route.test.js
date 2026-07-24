import { describe, expect, it, vi } from "vitest";

const { getSummaryMock } = vi.hoisted(() => ({
  getSummaryMock: vi.fn(async () => ({
    totalCount: 3,
    lastEvent: { provider: "dashscope", model: "glm-5.2" },
    recentEvents: [],
  })),
}));

vi.mock("@/lib/fork/rateLimitNormalization.js", () => ({
  getRateLimitNormalizationSummary: getSummaryMock,
}));

describe("rate-limit normalization dashboard API", () => {
  it("returns the persisted correction summary without caching", async () => {
    const { GET } = await import("../../src/app/api/fork/rate-limit-normalizations/route.js");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      totalCount: 3,
      lastEvent: { provider: "dashscope", model: "glm-5.2" },
      recentEvents: [],
    });
  });
});
