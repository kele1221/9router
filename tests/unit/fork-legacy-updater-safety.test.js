import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectForkUpdateStatus: vi.fn(async () => ({
    currentVersion: "0.5.40-k.2",
    upstream: { hasUpdate: true, aheadBy: 2 },
    sync: { status: "update_available" },
    fork: { hasInstallUpdate: false, latestVersion: null },
    checkedAt: "2026-07-23T10:00:00.000Z",
    healthy: true,
  })),
  killAppProcesses: vi.fn(),
  spawnUpdaterAndExit: vi.fn(),
}));

vi.mock("@/lib/fork/updateStatus.js", () => ({
  collectForkUpdateStatus: mocks.collectForkUpdateStatus,
}));

vi.mock("@/lib/appUpdater", () => ({
  killAppProcesses: mocks.killAppProcesses,
  spawnUpdaterAndExit: mocks.spawnUpdaterAndExit,
}));

describe("legacy updater safety in fork mode", () => {
  it("reports fork status instead of checking the official npm package", async () => {
    const { GET } = await import("../../src/app/api/version/route.js");

    const response = await GET();
    const payload = await response.json();

    expect(payload.currentVersion).toBe("0.5.40-k.2");
    expect(payload.hasUpdate).toBe(false);
    expect(payload.upstream.aheadBy).toBe(2);
  });

  it("refuses the legacy in-place npm updater", async () => {
    const { POST } = await import("../../src/app/api/version/update/route.js");

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.message).toContain("Fork Release");
    expect(mocks.killAppProcesses).not.toHaveBeenCalled();
    expect(mocks.spawnUpdaterAndExit).not.toHaveBeenCalled();
  });
});
