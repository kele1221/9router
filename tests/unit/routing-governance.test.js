import { describe, expect, it } from "vitest";

const config = {
  schemaVersion: 1,
  chain: {
    id: "claude-cn-primary",
    hops: [
      { id: "client", kind: "client", name: "Claude Code (claude-cn)" },
      { id: "model-switch", kind: "proxy", name: "Model-Switch", url: "http://127.0.0.1:15721" },
      { id: "9router", kind: "router", name: "9Router Fork", url: "http://127.0.0.1:20128" },
      {
        id: "sto",
        kind: "provider",
        name: "sto",
        providerNodeId: "openai-compatible-chat-test",
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
  documents: [{ id: "chain", title: "Chain", path: "docs/routing/CHAIN.md" }],
};

const healthyRuntimeState = {
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
};

describe("routing governance status", () => {
  it("verifies the declared provider node against the running database", async () => {
    const { buildRoutingGovernanceStatus } = await import("../../src/lib/fork/routingGovernance.js");
    const status = buildRoutingGovernanceStatus({
      config,
      providerNodes: [{
        id: "openai-compatible-chat-test",
        name: "sto",
        baseUrl: "https://provider.example/v1",
      }],
      runtimeState: healthyRuntimeState,
      now: () => new Date("2026-07-23T10:00:00.000Z"),
    });

    expect(status.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "provider-node-exists", status: "pass" }),
      expect.objectContaining({ id: "provider-base-url", status: "pass" }),
      expect.objectContaining({ id: "response-normalization", status: "pass" }),
      expect.objectContaining({ id: "claude-cn-model-switch-route", status: "pass" }),
      expect.objectContaining({ id: "model-switch-takeover-token", status: "pass" }),
      expect.objectContaining({ id: "model-switch-health", status: "pass" }),
      expect.objectContaining({ id: "model-switch-9router-route", status: "pass" }),
    ]));
    expect(status.actualProviderNode).toEqual({
      id: "openai-compatible-chat-test",
      name: "sto",
      baseUrl: "https://provider.example/v1",
    });
    expect(status.checkedAt).toBe("2026-07-23T10:00:00.000Z");
  });

  it("reports configuration drift without exposing credentials", async () => {
    const { buildRoutingGovernanceStatus } = await import("../../src/lib/fork/routingGovernance.js");
    const status = buildRoutingGovernanceStatus({
      config,
      providerNodes: [{
        id: "openai-compatible-chat-test",
        name: "sto",
        baseUrl: "https://different.example/v1",
        apiKey: "must-not-leak",
      }],
      runtimeState: healthyRuntimeState,
    });

    expect(status.checks.find((check) => check.id === "provider-base-url")?.status).toBe("fail");
    expect(JSON.stringify(status)).not.toContain("must-not-leak");
  });

  it("reports when Claude-CN bypasses Model-Switch", async () => {
    const { buildRoutingGovernanceStatus } = await import("../../src/lib/fork/routingGovernance.js");
    const status = buildRoutingGovernanceStatus({
      config,
      providerNodes: [{
        id: "openai-compatible-chat-test",
        name: "sto",
        baseUrl: "https://provider.example/v1",
      }],
      runtimeState: {
        ...healthyRuntimeState,
        client: {
          ...healthyRuntimeState.client,
          baseUrl: "http://127.0.0.1:20128/v1",
        },
      },
    });

    expect(status.healthy).toBe(false);
    expect(status.checks.find((check) => check.id === "claude-cn-model-switch-route")?.status).toBe("fail");
  });
});
