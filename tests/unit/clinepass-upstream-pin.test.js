import { describe, expect, it } from "vitest";
import {
  applyClinePassRouting,
  buildClinePassUpstreamObservation,
  extractClinePassRouting,
  observeClinePassRouting,
} from "../../open-sse/shared/clinePassRouting.js";
import {
  getModelUpstreamPin,
} from "../../open-sse/config/providerModels.js";

const PIN = { mode: "strict", upstreams: ["deepseek"] };

describe("ClinePass DeepSeek upstream pin", () => {
  it("declares the fixed pin only on the two DeepSeek models", () => {
    expect(getModelUpstreamPin("clinepass", "cline-pass/deepseek-v4.1-flash")).toEqual(PIN);
    expect(getModelUpstreamPin("clinepass", "cline-pass/deepseek-v4-pro")).toEqual(PIN);
    expect(getModelUpstreamPin("clinepass", "cline-pass/glm-5.3")).toBeNull();
  });

  it("writes both supported Cline pipeline fields without mutating input", () => {
    const body = {
      model: "cline-pass/deepseek-v4.1-flash",
      provider: { ignore: ["example"] },
      providerOptions: { gateway: { has: ["vision"] } },
      messages: [{ role: "user", content: "hi" }],
    };
    const original = structuredClone(body);
    const routed = applyClinePassRouting({ provider: "clinepass", body, pin: PIN });

    expect(routed.provider).toEqual({ ignore: ["example"], only: ["deepseek"] });
    expect(routed.providerOptions.gateway).toEqual({ has: ["vision"], only: ["deepseek"] });
    expect(body).toEqual(original);
    expect(routed).not.toBe(body);
  });

  it("uses ordered lists in preferred mode", () => {
    const routed = applyClinePassRouting({
      provider: "clinepass",
      body: { model: "m", messages: [] },
      pin: { mode: "preferred", upstreams: ["deepseek", "alibaba"] },
    });
    expect(routed.provider.order).toEqual(["deepseek", "alibaba"]);
    expect(routed.providerOptions.gateway.order).toEqual(["deepseek", "alibaba"]);
    expect(routed.provider.only).toBeUndefined();
  });

  it.each(["deepseek", "openai", "cmc"])("never modifies provider %s", (provider) => {
    const body = { model: "deepseek-v4-pro", provider: { only: ["alibaba"] } };
    expect(applyClinePassRouting({ provider, body, pin: PIN })).toBe(body);
  });

  it("extracts actual provider from direct and planner responses", () => {
    expect(extractClinePassRouting({ provider: "DeepSeek" })).toBe("DeepSeek");
    expect(extractClinePassRouting({
      choices: [{ message: { provider_metadata: { gateway: { routing: { finalProvider: "deepseek" } } } } }],
    })).toBe("deepseek");
    expect(extractClinePassRouting({
      provider_metadata: { gateway: { routing: { finalProvider: "baseten" } } },
    })).toBe("baseten");
  });

  it("marks missing evidence as unverified rather than assuming the pin worked", () => {
    const observation = buildClinePassUpstreamObservation("deepseek", null);
    expect(observation).toEqual({
      expected: "deepseek",
      actual: null,
      observed: false,
      match: "unverified",
    });
    expect(buildClinePassUpstreamObservation("deepseek", "baseten").match).toBe("not-adopted");
  });

  it("records a metadata-only streamed frame as actual upstream evidence", () => {
    const observation = buildClinePassUpstreamObservation("deepseek", null);
    expect(observeClinePassRouting(observation, {
      choices: [{ delta: {}, message: { provider_metadata: { gateway: { routing: { finalProvider: "deepseek" } } } } }],
    })).toEqual({
      expected: "deepseek",
      actual: "deepseek",
      observed: true,
      match: "adopted",
    });
  });
});
