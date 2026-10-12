// AC2 regression: a model-level error must not write a modelLock_* or flip the
// connection to testStatus:"unavailable". Before the fix, a ClinePass 404
// ("model not found" for an id the registry still listed) locked the account for
// 120s, which cannot help — every account returns the same answer.
//
// markAccountUnavailable() returns early when checkFallbackError says
// shouldFallback === false, and the lock write lives after that return, so the
// assertion is that updateProviderConnection is never called.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(() => null),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: vi.fn(async () => true),
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: mocks.pickProxyPoolId,
}));

vi.mock("@/lib/network/proxyPoolManager", () => ({
  getRotationManager: () => ({ pickProxy: vi.fn(async () => null), markProxyUsed: vi.fn(async () => {}) }),
}));

import { markAccountUnavailable } from "../../src/sse/services/auth.js";

const CONN = { id: "conn-1", displayName: "acct", backoffLevel: 0 };

const MODEL_NOT_FOUND = JSON.stringify({ error: "model not found", success: false });
const DEEPSEEK_MODEL_ID_ERROR =
  "The supported API model names are deepseek-flash, deepseek-v4-pro, " +
  "but you passed deepseek-v4.1-flash.";

describe("markAccountUnavailable does not lock on model-level errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([CONN]);
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });

  it("writes neither modelLock_* nor testStatus for a 404 'model not found'", async () => {
    const result = await markAccountUnavailable("conn-1", 404, MODEL_NOT_FOUND, "clinepass", "cline-pass/glm-5.2");

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("writes neither modelLock_* nor testStatus for the rejected DeepSeek model id", async () => {
    const result = await markAccountUnavailable("conn-1", 400, DEEPSEEK_MODEL_ID_ERROR, "deepseek", "deepseek-v4.1-flash");

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("still locks the account for an account-scoped 429", async () => {
    // Guardrail: the fix must not disable account locking in general.
    const result = await markAccountUnavailable("conn-1", 429, "rate limit exceeded", "deepseek", "deepseek-v4-pro");

    expect(result.shouldFallback).toBe(true);
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    const update = mocks.updateProviderConnection.mock.calls[0][1];
    expect(Object.keys(update).some((k) => k.startsWith("modelLock_"))).toBe(true);
    expect(update.testStatus).toBe("unavailable");
  });

  it("still locks the account for a 401", async () => {
    const result = await markAccountUnavailable("conn-1", 401, "invalid api key", "deepseek", "deepseek-v4-pro");

    expect(result.shouldFallback).toBe(true);
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
  });
});
