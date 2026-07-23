import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const config = {
  chain: {
    hops: [
      { id: "model-switch", kind: "proxy", url: "http://127.0.0.1:15721" },
      { id: "9router", kind: "router", url: "http://127.0.0.1:20128" },
    ],
  },
  runtimeVerification: {
    clientSettingsPath: "~/.claude-cn/settings.json",
    modelSwitchDatabasePath: "~/.model-switch/model-switch.db",
    modelSwitchAppType: "claude-cn",
    modelSwitchPathPrefix: "/claude-cn",
    routerApiPrefix: "/v1",
  },
};

describe("routing runtime inspection", () => {
  it("reads only the safe fields required to prove the live chain", async () => {
    const close = vi.fn();
    const openDatabase = vi.fn(() => ({
      prepare: () => ({
        get: () => ({
          id: "provider-id",
          name: "9Router",
          settings_config: JSON.stringify({
            env: {
              ANTHROPIC_BASE_URL: "http://localhost:20128/v1",
              ANTHROPIC_AUTH_TOKEN: "must-not-leak",
            },
          }),
        }),
      }),
      close,
    }));
    const readFile = vi.fn(async () => JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:15721/claude-cn",
        ANTHROPIC_AUTH_TOKEN: "PROXY_MANAGED",
      },
    }));
    const fetchImpl = vi.fn(async () => new Response('{"status":"healthy"}', { status: 200 }));
    const { loadRoutingRuntimeState } = await import("../../src/lib/fork/routingRuntime.js");

    const state = await loadRoutingRuntimeState(config, {
      homeDir: "/Users/test",
      readFile,
      openDatabase,
      fetchImpl,
    });

    expect(readFile).toHaveBeenCalledWith(path.join("/Users/test", ".claude-cn", "settings.json"), "utf8");
    expect(openDatabase).toHaveBeenCalledWith(path.join("/Users/test", ".model-switch", "model-switch.db"));
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:15721/health",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(state).toEqual({
      client: {
        settingsReadable: true,
        baseUrl: "http://127.0.0.1:15721/claude-cn",
        authTokenManaged: true,
      },
      modelSwitch: {
        databaseReadable: true,
        reachable: true,
        currentProvider: {
          id: "provider-id",
          name: "9Router",
          baseUrl: "http://localhost:20128/v1",
        },
      },
    });
    expect(JSON.stringify(state)).not.toContain("must-not-leak");
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns failed runtime evidence instead of leaking read errors", async () => {
    const { loadRoutingRuntimeState } = await import("../../src/lib/fork/routingRuntime.js");
    const state = await loadRoutingRuntimeState(config, {
      homeDir: "/Users/test",
      readFile: async () => { throw new Error("secret file detail"); },
      openDatabase: () => { throw new Error("secret db detail"); },
      fetchImpl: async () => { throw new Error("secret network detail"); },
    });

    expect(state).toEqual({
      client: { settingsReadable: false, baseUrl: null, authTokenManaged: false },
      modelSwitch: { databaseReadable: false, reachable: false, currentProvider: null },
    });
    expect(JSON.stringify(state)).not.toContain("secret");
  });
});
