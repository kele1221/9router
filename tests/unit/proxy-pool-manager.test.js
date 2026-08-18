import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyPoolManager } from "@/lib/network/proxyPoolManager";
import { getProxyPools, getProxyPoolById, updateProxyPool } from "@/models";
import { getSettings } from "@/lib/localDb";
import { testProxyUrl } from "@/lib/network/proxyTest.js";

vi.mock("@/models", () => ({
  getProxyPools: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProxyPool: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(),
}));

vi.mock("@/lib/network/proxyTest.js", () => ({
  testProxyUrl: vi.fn(),
}));

const U1 = "http://10.0.0.1:8080";
const U2 = "http://10.0.0.2:8080";
const U4 = "http://10.0.0.4:8080";

function pool(id, proxyUrl, extra = {}) {
  return {
    id,
    isActive: true,
    proxyUrl,
    type: "http",
    strictProxy: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSettings.mockResolvedValue({ proxyRotation: {} });
  getProxyPoolById.mockResolvedValue(null);
  updateProxyPool.mockResolvedValue({});
  testProxyUrl.mockResolvedValue({ ok: true, elapsedMs: 100 });
});

describe("ProxyPoolManager.pickProxy", () => {
  it("skips inactive, url-less, excluded and frozen pools", async () => {
    getProxyPools.mockResolvedValue([
      pool("a", U1),
      pool("b", U2, { isActive: false }),
      pool("c", "", { isActive: true }),
      pool("d", U4),
    ]);
    const m = new ProxyPoolManager();
    const pick = await m.pickProxy({ excludeUrls: new Set([U4]) });
    expect(pick.proxyUrl).toBe(U1);

    // Freeze d too — should still not be chosen while frozen.
    await m.markProxyFailed({ url: U4, poolId: "d", errorType: "network", now: 0 });
    const pick2 = await m.pickProxy({});
    expect(pick2.proxyUrl).toBe(U1);
  });

  it("cold start returns least-recently-used and rotates after markProxyUsed", async () => {
    getProxyPools.mockResolvedValue([pool("a", U1), pool("b", U2)]);
    const m = new ProxyPoolManager();
    expect((await m.pickProxy()).proxyUrl).toBe(U1);
    await m.markProxyUsed(U1, 1000);
    expect((await m.pickProxy()).proxyUrl).toBe(U2);
  });

  it("weights low latency higher; recency penalty makes a stale proxy win", async () => {
    getProxyPools.mockResolvedValue([pool("a", U1), pool("b", U2)]);
    const m = new ProxyPoolManager();
    testProxyUrl.mockResolvedValue({ ok: true, elapsedMs: 100 });
    await m.probeProxy(U1, "a");
    testProxyUrl.mockResolvedValue({ ok: true, elapsedMs: 2990 });
    await m.probeProxy(U2, "b");

    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect((await m.pickProxy()).proxyUrl).toBe(U1); // low latency

    // Recently used high-weight proxy gets ×0.3; high random lands on stale one.
    await m.markProxyUsed(U1, Date.now());
    spy.mockReturnValue(0.99);
    expect((await m.pickProxy()).proxyUrl).toBe(U2);
    spy.mockRestore();
  });

  it("rate_limit freezes for 5 minutes then auto-thaws", async () => {
    getProxyPools.mockResolvedValue([pool("a", U1), pool("b", U2)]);
    const m = new ProxyPoolManager();
    await m.markProxyFailed({ url: U1, poolId: "a", errorType: "rate_limit", now: 0 });
    expect((await m.pickProxy({ now: 1000 })).proxyUrl).toBe(U2);
    expect((await m.pickProxy({ now: 300001 })).proxyUrl).toBe(U1);
  });

  it("network failure freezes 30s and accumulates consecutiveFailures to disable", async () => {
    getProxyPools.mockResolvedValue([pool("a", U1), pool("b", U2)]);
    const m = new ProxyPoolManager();
    await m.markProxyFailed({ url: U1, poolId: "a", errorType: "network", now: 0 });
    expect(m._getState(U1, "a").networkFreezeUntil).toBe(30000);
    expect((await m.pickProxy({ now: 1000 })).proxyUrl).toBe(U2);

    await m.markProxyFailed({ url: U1, poolId: "a", errorType: "network", now: 31000 });
    await m.markProxyFailed({ url: U1, poolId: "a", errorType: "network", now: 62000 });
    expect(m._getState(U1, "a").consecutiveFailures).toBe(3);
    expect(m._getState(U1, "a").status).toBe("disabled");
    expect((await m.pickProxy({ now: 93000 })).proxyUrl).toBe(U2);
  });

  it("markProxySuccess clears freezes and failure counters", async () => {
    getProxyPools.mockResolvedValue([pool("a", U1), pool("b", U2)]);
    const m = new ProxyPoolManager();
    await m.markProxyFailed({ url: U1, poolId: "a", errorType: "network", now: 0 });
    await m.markProxySuccess(U1, 1000);
    const st = m._getState(U1, "a");
    expect(st.status).toBe("active");
    expect(st.consecutiveFailures).toBe(0);
    expect(st.networkFreezeUntil).toBe(0);
  });

  it("returns soonest-thawing candidate when all are frozen (never null)", async () => {
    getProxyPools.mockResolvedValue([pool("a", U1), pool("b", U2)]);
    const m = new ProxyPoolManager();
    await m.markProxyFailed({ url: U1, poolId: "a", errorType: "rate_limit", now: 0 });   // thaw 300000
    await m.markProxyFailed({ url: U2, poolId: "b", errorType: "rate_limit", now: 200000 }); // thaw 500000
    expect((await m.pickProxy({ now: 250000 })).proxyUrl).toBe(U1);
  });

  it("pinned url wins when still healthy", async () => {
    getProxyPools.mockResolvedValue([pool("a", U1), pool("b", U2)]);
    const m = new ProxyPoolManager();
    expect((await m.pickProxy({ pinned: U2 })).proxyUrl).toBe(U2);
  });
});

describe("ProxyPoolManager persistence", () => {
  it("persist writes health snapshot; new manager restores from pool.health", async () => {
    getProxyPools.mockResolvedValue([pool("a", U1), pool("b", U2)]);
    getProxyPoolById.mockImplementation((id) => (id === "a" ? pool("a", U1) : id === "b" ? pool("b", U2) : null));
    const m = new ProxyPoolManager();
    const now = Date.now();
    await m.markProxyFailed({ url: U1, poolId: "a", errorType: "rate_limit", now });
    await m.persist();
    expect(updateProxyPool).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({
        health: expect.objectContaining({ rateLimitedUntil: now + 300000, consecutiveFailures: 0 }),
      })
    );

    const health = updateProxyPool.mock.calls.find((c) => c[0] === "a")[1].health;
    getProxyPools.mockResolvedValue([
      { ...pool("a", U1), health },
      pool("b", U2),
    ]);
    const m2 = new ProxyPoolManager();
    // U1 rate-limited until now+5m → U2 wins.
    expect((await m2.pickProxy({})).proxyUrl).toBe(U2);
  });
});
