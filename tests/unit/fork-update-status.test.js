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
    expect(status.checkedAt).toBe("2026-07-23T10:00:00.000Z");
  });
});
