import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

describe("getThinkingLevels", () => {
  it.each([
    ["gpt-5.6-sol", ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]],
    ["gpt-5.6-terra", ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]],
    ["gpt-5.6-luna", ["none", "minimal", "low", "medium", "high", "xhigh", "max"]],
    ["gpt-5.6-sol-review", ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]],
    ["gpt-5.6-terra-review", ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]],
    ["gpt-5.6-luna-review", ["none", "minimal", "low", "medium", "high", "xhigh", "max"]],
  ])("returns Codex levels for %s", (model, expected) => {
    expect(getThinkingLevels("codex", model)).toEqual(expected);
  });

  it("does not expose Codex-only GPT-5.6 overrides on Kiro", () => {
    expect(getThinkingLevels("kiro", "gpt-5.6-sol")).toEqual([
      "none", "minimal", "low", "medium", "high", "xhigh",
    ]);
  });

  it("does not add max for other codex models", () => {
    const levels = getThinkingLevels("codex", "gpt-5.3-codex");
    expect(levels).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("does not add max for other Codex models", () => {
    const levels = getThinkingLevels("codex", "gpt-5.5");
    expect(levels || []).not.toContain("max");
  });

  it("strips minimal for custom openai-compatible providers", () => {
    const levels = getThinkingLevels("openai-compatible-chat-09f9a1a8", "deepseek-v4-flash");
    expect(levels).toEqual(["none", "low", "medium", "high", "xhigh"]);
    expect(levels).not.toContain("minimal");
  });

  it("keeps native deepseek levels on the official provider", () => {
    const levels = getThinkingLevels("deepseek", "deepseek-v4-flash");
    expect(levels).toEqual(["none", "high", "max"]);
  });
});
