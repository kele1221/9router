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
  documents: [{ id: "chain", title: "Chain", path: "docs/routing/CHAIN.md" }],
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
      now: () => new Date("2026-07-23T10:00:00.000Z"),
    });

    expect(status.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "provider-node-exists", status: "pass" }),
      expect.objectContaining({ id: "provider-base-url", status: "pass" }),
      expect.objectContaining({ id: "response-normalization", status: "pass" }),
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
    });

    expect(status.checks.find((check) => check.id === "provider-base-url")?.status).toBe("fail");
    expect(JSON.stringify(status)).not.toContain("must-not-leak");
  });
});
