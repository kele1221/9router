import path from "node:path";
import { describe, expect, it } from "vitest";

describe("local routing configuration", () => {
  it("prefers the private DATA_DIR overlay", async () => {
    const localConfig = { schemaVersion: 1, chain: { id: "private", hops: [] }, responseRules: [], documents: [] };
    const readFile = async (file, encoding) => {
      expect(file).toBe(path.join("/private/data", "fork", "routing-chains.local.json"));
      expect(encoding).toBe("utf8");
      return JSON.stringify(localConfig);
    };
    const { loadRoutingConfig } = await import("../../src/lib/fork/routingConfig.js");

    await expect(loadRoutingConfig({ dataDir: "/private/data", readFile })).resolves.toEqual({
      config: localConfig,
      source: "local",
      localConfigRelativePath: "fork/routing-chains.local.json",
    });
  });

  it("uses the public template only when the private overlay is absent", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const { loadRoutingConfig } = await import("../../src/lib/fork/routingConfig.js");
    const result = await loadRoutingConfig({
      dataDir: "/private/data",
      readFile: async () => { throw missing; },
    });

    expect(result.source).toBe("template");
    expect(result.config.chain.hops.find((hop) => hop.kind === "provider")?.baseUrl).toBe("https://provider.example/v1");
  });

  it("does not silently ignore a malformed private overlay", async () => {
    const { loadRoutingConfig } = await import("../../src/lib/fork/routingConfig.js");
    await expect(loadRoutingConfig({
      dataDir: "/private/data",
      readFile: async () => "not-json",
    })).rejects.toThrow();
  });
});
