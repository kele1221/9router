import { describe, expect, it, vi } from "vitest";

describe("fork update status", () => {
  it("separates upstream source updates from installable fork releases", async () => {
    const fetchImpl = vi.fn(async (url) => {
      const value = String(url);
      if (value.includes("/compare/product...decolua:master")) {
        return Response.json({ status: "diverged", ahead_by: 3, behind_by: 7 });
      }
      if (value.includes("/pulls?")) {
        return Response.json([{
          number: 12,
          html_url: "https://github.com/kele1221/9router/pull/12",
          mergeable_state: "clean",
        }]);
      }
      if (value.endsWith("/releases/latest")) {
        return Response.json({
          tag_name: "fork-v0.5.40-k.2",
          html_url: "https://github.com/kele1221/9router/releases/tag/fork-v0.5.40-k.2",
        });
      }
      throw new Error(`Unexpected URL: ${value}`);
    });

    const { collectForkUpdateStatus } = await import("../../src/lib/fork/updateStatus.js");
    const status = await collectForkUpdateStatus({
      fetchImpl,
      currentVersion: "0.5.40-k.1",
      now: () => new Date("2026-07-23T10:00:00.000Z"),
    });

    expect(status.upstream.hasUpdate).toBe(true);
    expect(status.upstream.aheadBy).toBe(3);
    expect(status.sync.status).toBe("pr_open");
    expect(status.sync.prNumber).toBe(12);
    expect(status.fork.hasInstallUpdate).toBe(true);
    expect(status.fork.latestVersion).toBe("0.5.40-k.2");
    expect(status.availability).toEqual({ comparison: true, pulls: true, release: true });
    expect(status.healthy).toBe(true);
    expect(status.checkedAt).toBe("2026-07-23T10:00:00.000Z");
  });

  it("reports GitHub rate limiting as unknown instead of current", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 403 }));
    const { collectForkUpdateStatus } = await import("../../src/lib/fork/updateStatus.js");

    const status = await collectForkUpdateStatus({
      fetchImpl,
      currentVersion: "0.5.40-k.2",
      now: () => new Date("2026-07-23T10:30:00.000Z"),
    });

    expect(status.healthy).toBe(false);
    expect(status.availability).toEqual({ comparison: false, pulls: false, release: false });
    expect(status.upstream.comparisonStatus).toBe("unknown");
    expect(status.sync.status).toBe("unknown");
    expect(status.fork.latestVersion).toBeNull();
  });
});
