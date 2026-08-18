// GHSA-style regression guard: /v1/models must keep listing no-auth free
// providers (e.g. OpenCode Free) once any provider connection exists, or their
// custom/alias models disappear from CLI model pickers.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

describe("/v1/models with no-auth free providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("keeps OpenCode Free custom models when a connection exists", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "opencode-go", id: "c1", isActive: true },
    ]);
    mocks.getCustomModels.mockResolvedValue([
      { providerAlias: "oc", id: "mimo-v2.5-free", type: "llm" },
    ]);

    const ids = (await buildModelsList(["llm"])).map((m) => m.id);

    expect(ids).toContain("oc/mimo-v2.5-free");
    expect(ids).toContain("ocg/deepseek-v4-flash");
  });

  it("does not expose hidden no-auth providers (mimo-free)", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "opencode-go", id: "c1", isActive: true },
    ]);
    mocks.getCustomModels.mockResolvedValue([
      { providerAlias: "mmf", id: "mimo-auto", type: "llm" },
    ]);

    const ids = (await buildModelsList(["llm"])).map((m) => m.id);

    expect(ids).not.toContain("mmf/mimo-auto");
  });
});
