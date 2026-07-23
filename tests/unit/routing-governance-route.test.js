import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderNodes: vi.fn(async () => ([
    {
      id: "openai-compatible-chat-private",
      name: "Private provider",
      baseUrl: "https://provider.example/v1",
      apiKey: "must-not-leak",
    },
  ])),
  loadRoutingConfig: vi.fn(async () => ({
    source: "local",
    localConfigRelativePath: "fork/routing-chains.local.json",
    config: {
      schemaVersion: 1,
      chain: {
        id: "private-chain",
        hops: [
          { id: "model-switch", kind: "proxy", name: "Model-Switch", url: "http://127.0.0.1:15721" },
          { id: "9router", kind: "router", name: "9Router", url: "http://127.0.0.1:20128" },
          {
            id: "provider",
            kind: "provider",
            name: "Private provider",
            providerNodeId: "openai-compatible-chat-private",
            baseUrl: "https://provider.example/v1",
          },
        ],
      },
      responseRules: [{
        id: "rate-limit-400-to-429",
        when: { status: 400, errorCodeOrType: "rate_limit_exceeded" },
        then: { effectiveStatus: 429, preserveBody: true },
      }],
      runtimeVerification: {
        clientSettingsPath: "~/.claude-cn/settings.json",
        modelSwitchDatabasePath: "~/.model-switch/model-switch.db",
        modelSwitchAppType: "claude-cn",
        modelSwitchPathPrefix: "/claude-cn",
        routerApiPrefix: "/v1",
      },
      documents: [],
    },
  })),
  loadRoutingRuntimeState: vi.fn(async () => ({
    client: {
      settingsReadable: true,
      baseUrl: "http://127.0.0.1:15721/claude-cn",
      authTokenManaged: true,
    },
    modelSwitch: {
      databaseReadable: true,
      reachable: true,
      currentProvider: {
        id: "model-switch-provider",
        name: "9Router",
        baseUrl: "http://localhost:20128/v1",
      },
    },
  })),
}));

vi.mock("@/lib/localDb.js", () => ({
  getProviderNodes: mocks.getProviderNodes,
}));

vi.mock("@/lib/fork/routingConfig.js", () => ({
  loadRoutingConfig: mocks.loadRoutingConfig,
}));

vi.mock("@/lib/fork/routingRuntime.js", () => ({
  loadRoutingRuntimeState: mocks.loadRoutingRuntimeState,
}));

describe("routing governance API", () => {
  it("validates the declared chain without exposing credentials", async () => {
    const { GET } = await import("../../src/app/api/fork/routing-governance/route.js");
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.healthy).toBe(true);
    expect(payload.configSource).toBe("local");
    expect(mocks.loadRoutingRuntimeState).toHaveBeenCalledOnce();
    expect(payload.actualProviderNode).toEqual({
      id: "openai-compatible-chat-private",
      name: "Private provider",
      baseUrl: "https://provider.example/v1",
    });
    expect(JSON.stringify(payload)).not.toContain("must-not-leak");
  });
});
