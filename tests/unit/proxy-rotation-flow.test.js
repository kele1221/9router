import { beforeEach, describe, expect, it, vi } from "vitest";
import { tryRotateProxy } from "@/lib/network/proxyRotation";
import { getRotationManager } from "@/lib/network/proxyPoolManager";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { getProxyPools, getProxyPoolById, updateProxyPool } from "@/models";
import { getSettings, getProviderConnections, updateProviderConnection, getProxyPools as getProxyPoolsDb } from "@/lib/localDb";

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProxyPools: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProxyPool: vi.fn(),
}));

vi.mock("@/lib/network/proxyTest.js", () => ({
  testProxyUrl: vi.fn(),
}));

const U1 = "http://10.0.0.1:8080";
const U2 = "http://10.0.0.2:8080";

function pool(id, proxyUrl, extra = {}) {
  return { id, isActive: true, proxyUrl, type: "http", strictProxy: false, groupId: "g", updatedAt: "2026-01-01T00:00:00.000Z", ...extra };
}

function creds(proxyUrl, poolId = "pool1", connectionId = "conn1") {
  return {
    connectionId,
    providerSpecificData: {
      connectionProxyEnabled: true,
      connectionProxyUrl: proxyUrl,
      connectionProxyPoolId: poolId,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getRotationManager().state.clear();
  getRotationManager().dirtyPoolIds.clear();
  getSettings.mockResolvedValue({
    proxyRotation: { enabled: true, maxRotationsPerRequest: 3 },
    fallbackStrategy: "fill-first",
    providerStrategies: {},
  });
  getProviderConnections.mockResolvedValue([
    {
      id: "conn1",
      name: "conn1",
      isActive: true,
      priority: 1,
      authType: "apiKey",
      apiKey: "k",
      providerSpecificData: { proxyPoolId: "pool1" },
    },
  ]);
  updateProviderConnection.mockResolvedValue({});
  getProxyPoolById.mockImplementation((id) =>
    id === "pool1" ? pool("pool1", U1) : id === "pool2" ? pool("pool2", U2) : null
  );
  getProxyPools.mockResolvedValue([pool("pool1", U1), pool("pool2", U2)]);
  getProxyPoolsDb.mockResolvedValue([pool("pool1", U1), pool("pool2", U2)]);
});

describe("tryRotateProxy", () => {
  it("429 on a group pool rotates: marks failed proxy, pins next, keeps account", async () => {
    const ctx = { proxyExcludes: new Set(), rotationBudget: null, pinnedConnectionId: null };
    const res = await tryRotateProxy(ctx, {
      credentials: creds(U1),
      status: 429,
      error: "rate limit",
    });
    expect(res).toEqual({ rotated: true, changed: true, reason: "rate_limit" });
    expect(ctx.proxyExcludes.has(U1)).toBe(true);
    expect(ctx.pinnedConnectionId).toBe("conn1");
    expect(ctx.pin).toBe(U2);
    expect(ctx.rotationBudget).toBe(2);
  });

  it("network text (ECONNRESET as 502) rotates too", async () => {
    const ctx = { proxyExcludes: new Set(), rotationBudget: null };
    const res = await tryRotateProxy(ctx, {
      credentials: creds(U1),
      status: 502,
      error: "fetch failed: ECONNRESET",
    });
    expect(res.rotated).toBe(true);
    expect(res.reason).toBe("network");
  });

  it("401 / 499 / upstream 502 without network text do not rotate", async () => {
    for (const [status, error] of [[401, "unauthorized"], [499, "Aborted"], [502, "upstream exploded"]]) {
      const ctx = { proxyExcludes: new Set(), rotationBudget: null };
      const res = await tryRotateProxy(ctx, { credentials: creds(U1), status, error });
      expect(res.rotated).toBe(false);
      expect(ctx.proxyExcludes.size).toBe(0);
    }
  });

  it("budget exhausted terminates", async () => {
    const ctx = { proxyExcludes: new Set(), rotationBudget: 0 };
    const res = await tryRotateProxy(ctx, { credentials: creds(U1), status: 429, error: "rl" });
    expect(res).toEqual({ rotated: false, changed: false, reason: "budget" });
  });

  it("global switch off → no-op", async () => {
    getSettings.mockResolvedValue({ proxyRotation: { enabled: false } });
    const ctx = { proxyExcludes: new Set(), rotationBudget: null };
    const res = await tryRotateProxy(ctx, { credentials: creds(U1), status: 429, error: "rl" });
    expect(res).toEqual({ rotated: false, changed: false, reason: "disabled" });
  });

  it("relay pools never rotate", async () => {
    getProxyPoolById.mockResolvedValue(pool("pool1", U1, { type: "vercel" }));
    const ctx = { proxyExcludes: new Set(), rotationBudget: null };
    const res = await tryRotateProxy(ctx, { credentials: creds(U1), status: 429, error: "rl" });
    expect(res).toEqual({ rotated: false, changed: false, reason: "relay" });
  });

  it("no healthy alternative → rotated:false so account fallback runs", async () => {
    getProxyPools.mockResolvedValue([pool("pool1", U1)]);
    const ctx = { proxyExcludes: new Set(), rotationBudget: null };
    const res = await tryRotateProxy(ctx, { credentials: creds(U1), status: 429, error: "rl" });
    expect(res.rotated).toBe(false);
    expect(res.reason).toBe("no-candidate");
  });
});

describe("getProviderCredentials + rotation flow", () => {
  it("regular connection: rotation retry keeps same account and changes proxy URL", async () => {
    const ctx = { proxyExcludes: new Set(), rotationBudget: null, pinnedConnectionId: null };
    const creds1 = await getProviderCredentials("openai", new Set(), null, { rotation: ctx });
    expect(creds1.connectionId).toBe("conn1");
    expect(creds1.providerSpecificData.connectionProxyUrl).toBe(U1);

    // Simulate upstream 429 → rotation hook freezes U1 and pre-picks U2.
    const rot = await tryRotateProxy(ctx, {
      credentials: creds(U1, creds1.providerSpecificData.connectionProxyPoolId),
      status: 429,
      error: "rate limit",
    });
    expect(rot.rotated).toBe(true);
    expect(ctx.pin).toBe(U2);

    const creds2 = await getProviderCredentials("openai", new Set(), null, { rotation: ctx });
    expect(creds2.connectionId).toBe("conn1"); // same account
    expect(creds2.providerSpecificData.connectionProxyUrl).toBe(U2); // new IP
  });

  it("noauth free provider rotates through the pool without account lock", async () => {
    getSettings.mockResolvedValue({
      proxyRotation: { enabled: true, maxRotationsPerRequest: 3 },
      providerStrategies: { opencode: { rotateStrategy: "round-robin" } },
    });
    const ctx = { proxyExcludes: new Set(), rotationBudget: null, pinnedConnectionId: null };
    const creds1 = await getProviderCredentials("opencode", new Set(), null, { rotation: ctx });
    expect(creds1.id).toBe("noauth");
    expect(creds1.providerSpecificData.connectionProxyUrl).toBe(U1);

    const rot = await tryRotateProxy(ctx, {
      credentials: creds(U1, creds1.providerSpecificData.connectionProxyPoolId, "noauth"),
      status: 429,
      error: "rate limit",
    });
    expect(rot.rotated).toBe(true);

    const creds2 = await getProviderCredentials("opencode", new Set(), null, { rotation: ctx });
    expect(creds2.providerSpecificData.connectionProxyUrl).toBe(U2);
  });
});
