import { describe, expect, it } from "vitest";
import { disabledModelIdsFor, isComboFullyDisabled, isModelDisabled } from "../../src/shared/utils/modelAvailability.js";

const disabled = { openai: ["gpt-4o"], "openai-compatible-chat-abc": ["glm-4.7"] };

describe("model picker disabled filtering", () => {
  it("matches disabled ids under the raw provider id and its alias", () => {
    expect(isModelDisabled(disabled, "openai/gpt-4o")).toBe(true);
    expect(isModelDisabled(disabled, "openai/gpt-5")).toBe(false);
    expect(isModelDisabled(disabled, "openai-compatible-chat-abc/glm-4.7")).toBe(true);
    expect(isModelDisabled(disabled, "combo-name")).toBe(false);
    expect(isModelDisabled({}, "openai/gpt-4o")).toBe(false);
  });

  it("collects ids for a prefix (both keyings)", () => {
    expect(disabledModelIdsFor(disabled, "openai")).toEqual(["gpt-4o"]);
  });

  it("hides a combo only when nothing is left to route to", () => {
    expect(isComboFullyDisabled({ models: ["openai/gpt-4o", "openai/gpt-4o-mini"] }, { openai: ["gpt-4o", "gpt-4o-mini"] })).toBe(true);
    expect(isComboFullyDisabled({ models: ["openai/gpt-4o", "kiro/claude-x"] }, disabled)).toBe(false);
    expect(isComboFullyDisabled({ models: [] }, disabled)).toBe(false);
  });
});
