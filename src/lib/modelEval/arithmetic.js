// Shared parsing and grading for arithmetic evaluation prompts. Keep this
// deliberately narrow: answers are one finite decimal literal, not prose or
// expressions, so a result can be compared without model-specific heuristics.
export const EVALUATION_TYPES = ["visual", "arithmetic"];

const DECIMAL_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export function normalizeFiniteDecimal(value) {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!DECIMAL_LITERAL.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? String(number) : null;
}

// Normalizes the public prompt shape. Omitted legacy fields deliberately mean
// visual so old stored prompts and callers retain their existing behavior.
export function validatePromptEvaluation({ evaluationType = "visual", expectedAnswer = null } = {}) {
  if (!EVALUATION_TYPES.includes(evaluationType)) return { error: "评测类型不合法" };
  if (evaluationType === "visual") return { value: { evaluationType: "visual", expectedAnswer: null } };
  const normalizedAnswer = normalizeFiniteDecimal(expectedAnswer);
  if (normalizedAnswer === null) return { error: "标准答案必须是单个有限十进制数字" };
  return { value: { evaluationType: "arithmetic", expectedAnswer: normalizedAnswer } };
}

export function evaluateArithmeticAnswer({ expectedAnswer, actualAnswer } = {}) {
  const expected = normalizeFiniteDecimal(expectedAnswer);
  const actualText = typeof actualAnswer === "string" ? actualAnswer : String(actualAnswer ?? "");
  const normalizedAnswer = normalizeFiniteDecimal(actualText);
  return {
    verdict: normalizedAnswer === null ? "invalid" : Number(normalizedAnswer) === Number(expected) ? "correct" : "incorrect",
    expectedAnswer: expected ?? String(expectedAnswer ?? ""),
    actualAnswer: actualText,
    normalizedAnswer,
  };
}
