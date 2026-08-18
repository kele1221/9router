import { describe, expect, it, vi } from "vitest";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getProxyPoolById, getProxyPools, updateProxyPool } from "@/models";
import { getSettings } from "@/lib/localDb";

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(),
  getProxyPools: vi.fn(),
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

function pool(id, proxyUrl, extra = {}) {
  return { id, isActive: true, proxyUrl, type: "http", strictProxy: true, updatedAt: "2026-01-01T00:00:00.000Z", ...extra };
}

describe("resolveConnectionProxyConfig", () => {
  it("single proxyPoolId without rotation → unchanged output fields", async () => {
    getProxyPoolById.mockResolvedValue(pool("p1", U1));
    const res = await resolveConnectionProxyConfig({ proxyPoolId: "p1" });
    expect(res).toEqual({
      source: "pool",
      proxyPoolId: "p1",
      proxyPool: pool("p1", U1),
      connectionProxyEnabled: true,
      connectionProxyUrl: U1,
      connectionNoProxy: "",
      strictProxy: true,
    });
  });

  it("__none__ still explicitly disables the pool", async () => {
    const res = await resolveConnectionProxyConfig({ proxyPoolId: "__none__" });
    expect(res.source).toBe("none");
    expect(res.connectionProxyEnabled).toBe(false);
    expect(res.connectionProxyUrl).toBe("");
  });

  it("groupId pool + rotation enabled → picks a concrete proxy URL", async () => {
    getProxyPoolById.mockResolvedValue(pool("p1", U1, { groupId: "g" }));
    getProxyPools.mockResolvedValue([pool("p1", U1, { groupId: "g" }), pool("p2", U2, { groupId: "g" })]);
    getSettings.mockResolvedValue({ proxyRotation: { enabled: true } });
    const rotation = { proxyExcludes: new Set(), pin: null };
    const res = await resolveConnectionProxyConfig({ proxyPoolId: "p1" }, { rotation });
    expect(res.rotationUsed).toBe(true);
    expect(res.connectionProxyEnabled).toBe(true);
    expect(res.connectionProxyUrl).toBe(U1);
    expect(res.strictProxy).toBe(true);
  });

  it("rotation disabled globally → falls back to bound pool output", async () => {
    getProxyPoolById.mockResolvedValue(pool("p1", U1, { groupId: "g" }));
    getProxyPools.mockResolvedValue([pool("p1", U1, { groupId: "g" }), pool("p2", U2, { groupId: "g" })]);
    getSettings.mockResolvedValue({ proxyRotation: { enabled: false } });
    const res = await resolveConnectionProxyConfig({ proxyPoolId: "p1" }, { rotation: { proxyExcludes: new Set() } });
    expect(res.rotationUsed).toBeUndefined();
    expect(res.connectionProxyUrl).toBe(U1);
  });

  it("proxyPoolIds array (multi) engages rotation without groupId", async () => {
    getProxyPoolById.mockResolvedValue(pool("p1", U1));
    getProxyPools.mockResolvedValue([pool("p1", U1), pool("p2", U2)]);
    getSettings.mockResolvedValue({ proxyRotation: { enabled: true } });
    const res = await resolveConnectionProxyConfig(
      { proxyPoolId: "p1", proxyPoolIds: ["p1", "p2"] },
      { rotation: { proxyExcludes: new Set() } }
    );
    expect(res.rotationUsed).toBe(true);
  });

  it("relay type keeps vercelRelayUrl branch untouched", async () => {
    getProxyPoolById.mockResolvedValue(pool("p1", "https://relay.example.com", { type: "vercel" }));
    const res = await resolveConnectionProxyConfig({ proxyPoolId: "p1" });
    expect(res.source).toBe("vercel");
    expect(res.connectionProxyEnabled).toBe(false);
    expect(res.vercelRelayUrl).toBe("https://relay.example.com");
  });
});
