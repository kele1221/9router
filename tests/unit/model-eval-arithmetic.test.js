import { describe, expect, it } from "vitest";
import { evaluateArithmeticAnswer, normalizeFiniteDecimal, validatePromptEvaluation } from "../../src/lib/modelEval/arithmetic.js";
import { BUILTIN_EVAL_PROMPTS } from "../../src/shared/constants/evalPrompts.js";

describe("model eval arithmetic validation", () => {
  it("normalizes one finite decimal literal only", () => {
    expect(normalizeFiniteDecimal(" 10.0 ")).toBe("10");
    expect(normalizeFiniteDecimal("-.5")).toBe("-0.5");
    expect(normalizeFiniteDecimal("1e1")).toBeNull();
    expect(normalizeFiniteDecimal("10 11")).toBeNull();
    expect(normalizeFiniteDecimal("答案是 10")).toBeNull();
    expect(normalizeFiniteDecimal("Infinity")).toBeNull();
  });

  it("keeps visual prompts backward-compatible and requires an arithmetic answer", () => {
    expect(validatePromptEvaluation()).toEqual({ value: { evaluationType: "visual", expectedAnswer: null } });
    expect(validatePromptEvaluation({ evaluationType: "arithmetic", expectedAnswer: "10.0" })).toEqual({ value: { evaluationType: "arithmetic", expectedAnswer: "10" } });
    expect(validatePromptEvaluation({ evaluationType: "arithmetic", expectedAnswer: "ten" }).error).toMatch(/标准答案/);
  });

  it("distinguishes correct, incorrect, and invalid model replies", () => {
    expect(evaluateArithmeticAnswer({ expectedAnswer: "10", actualAnswer: " 10.0\n" })).toMatchObject({ verdict: "correct", expectedAnswer: "10", normalizedAnswer: "10" });
    expect(evaluateArithmeticAnswer({ expectedAnswer: "10", actualAnswer: "9" })).toMatchObject({ verdict: "incorrect", normalizedAnswer: "9" });
    expect(evaluateArithmeticAnswer({ expectedAnswer: "10", actualAnswer: "答案是 10" })).toMatchObject({ verdict: "invalid", normalizedAnswer: null });
    expect(evaluateArithmeticAnswer({ expectedAnswer: "10", actualAnswer: "10 11" })).toMatchObject({ verdict: "invalid", normalizedAnswer: null });
  });

  it("ships the eight requested arithmetic presets with numeric answers", () => {
    const arithmetic = BUILTIN_EVAL_PROMPTS.filter((prompt) => prompt.evaluationType === "arithmetic");
    expect(arithmetic).toHaveLength(8);
    expect(arithmetic.map((prompt) => prompt.expectedAnswer)).toEqual(["10", "46", "3", "6", "2", "90", "13", "22"]);
    expect(arithmetic.every((prompt) => /只输出一个阿拉伯数字/.test(prompt.content))).toBe(true);
  });
});
