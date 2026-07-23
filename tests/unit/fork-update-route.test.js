import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectForkUpdateStatus: vi.fn(async () => ({
    currentVersion: "0.5.40-k.2",
    upstream: { hasUpdate: false, aheadBy: 0 },
    sync: { status: "current" },
    fork: { hasInstallUpdate: false },
    checkedAt: "2026-07-23T10:00:00.000Z",
    healthy: true,
  })),
}));

vi.mock("@/lib/fork/updateStatus.js", () => ({
  collectForkUpdateStatus: mocks.collectForkUpdateStatus,
}));

describe("fork status API", () => {
  it("returns the dual-channel update status", async () => {
    const { GET } = await import("../../src/app/api/fork/status/route.js");

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.currentVersion).toBe("0.5.40-k.2");
    expect(payload.upstream.hasUpdate).toBe(false);
    expect(payload.sync.status).toBe("current");

    await GET(new Request("http://localhost/api/fork/status?refresh=1"));
    expect(mocks.collectForkUpdateStatus).toHaveBeenCalledTimes(2);
  });
});
