import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectForkUpdateStatus: vi.fn(async () => ({
    currentVersion: "0.5.40-k.3",
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
  beforeEach(() => {
    vi.resetModules();
    delete global.__forkUpdateStatusCache;
    mocks.collectForkUpdateStatus.mockReset();
    mocks.collectForkUpdateStatus.mockResolvedValue({
      currentVersion: "0.5.40-k.3",
      upstream: { hasUpdate: false, aheadBy: 0 },
      sync: { status: "current" },
      fork: { hasInstallUpdate: false },
      checkedAt: "2026-07-23T10:00:00.000Z",
      healthy: true,
    });
  });

  it("returns the dual-channel update status", async () => {
    const { GET } = await import("../../src/app/api/fork/status/route.js");

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.currentVersion).toBe("0.5.40-k.3");
    expect(payload.upstream.hasUpdate).toBe(false);
    expect(payload.sync.status).toBe("current");

    await GET(new Request("http://localhost/api/fork/status?refresh=1"));
    expect(mocks.collectForkUpdateStatus).toHaveBeenCalledTimes(2);
  });

  it("keeps the last known data but marks it stale after a failed refresh", async () => {
    mocks.collectForkUpdateStatus
      .mockResolvedValueOnce({
        currentVersion: "0.5.40-k.3",
        upstream: { hasUpdate: false, aheadBy: 0 },
        sync: { status: "current" },
        fork: { latestVersion: "0.5.40-k.3", hasInstallUpdate: false },
        checkedAt: "2026-07-23T10:00:00.000Z",
        healthy: true,
      })
      .mockResolvedValueOnce({
        currentVersion: "0.5.40-k.3",
        upstream: { hasUpdate: false, aheadBy: 0, comparisonStatus: "unknown" },
        sync: { status: "unknown" },
        fork: { latestVersion: null, hasInstallUpdate: false },
        checkedAt: "2026-07-23T10:01:00.000Z",
        healthy: false,
      });
    const { GET } = await import("../../src/app/api/fork/status/route.js");

    await GET();
    const response = await GET(new Request("http://localhost/api/fork/status?refresh=1"));
    const payload = await response.json();

    expect(payload.healthy).toBe(false);
    expect(payload.stale).toBe(true);
    expect(payload.fork.latestVersion).toBe("0.5.40-k.3");
    expect(payload.refreshFailedAt).toBe("2026-07-23T10:01:00.000Z");
  });
});
