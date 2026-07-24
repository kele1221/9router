import { describe, expect, it, vi } from "vitest";

const { getDashboardMock } = vi.hoisted(() => ({
  getDashboardMock: vi.fn(async (period) => ({ period, modelStats: [{ model: "alpha" }] })),
}));

vi.mock("@/lib/fork/usageDashboard.js", () => ({
  getForkUsageDashboard: getDashboardMock,
}));

describe("fork usage dashboard API", () => {
  it("returns no-store data for a supported period", async () => {
    const { GET } = await import("../../src/app/api/fork/usage-dashboard/route.js");
    const response = await GET(new Request("http://localhost/api/fork/usage-dashboard?period=7d"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getDashboardMock).toHaveBeenCalledWith("7d");
    expect(await response.json()).toEqual({ period: "7d", modelStats: [{ model: "alpha" }] });
  });

  it("rejects an unsupported period", async () => {
    const { GET } = await import("../../src/app/api/fork/usage-dashboard/route.js");
    const response = await GET(new Request("http://localhost/api/fork/usage-dashboard?period=quarter"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid period" });
  });
});
