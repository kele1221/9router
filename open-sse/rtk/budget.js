// FastCtx-inspired output budgeting for already-structured tool results.
// This is intentionally conservative: callers only use it after a known RTK
// filter has produced a smaller, line-oriented representation.

export const RTK_MODES = {
  CLASSIC: "classic",
  BUDGET: "budget",
};

export const DEFAULT_RTK_BUDGET_TOKENS = 4000;
export const MIN_RTK_BUDGET_TOKENS = 128;
export const MAX_RTK_BUDGET_TOKENS = 100000;

const CHARS_PER_TOKEN_ESTIMATE = 4;

export function normalizeRtkMode(value) {
  return value === RTK_MODES.BUDGET ? RTK_MODES.BUDGET : RTK_MODES.CLASSIC;
}

export function normalizeRtkBudgetTokens(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_RTK_BUDGET_TOKENS;
  return Math.min(
    MAX_RTK_BUDGET_TOKENS,
    Math.max(MIN_RTK_BUDGET_TOKENS, Math.round(numeric)),
  );
}

export function estimateRtkTokens(text) {
  return Math.ceil(String(text || "").length / CHARS_PER_TOKEN_ESTIMATE);
}

function buildCandidate(lines, kept, totalLines) {
  if (kept >= totalLines) return lines.join("\n");

  const headCount = Math.max(1, Math.ceil(kept * 0.6));
  const tailCount = Math.max(0, kept - headCount);
  const omittedLines = totalLines - headCount - tailCount;
  const marker = `[RTK budget truncated: omitted ${omittedLines} lines]`;

  if (tailCount === 0) {
    return `${lines.slice(0, headCount).join("\n")}\n${marker}`;
  }

  return [
    ...lines.slice(0, headCount),
    marker,
    ...lines.slice(-tailCount),
  ].join("\n");
}

/**
 * Fit a line-oriented string into a conservative token estimate.
 * Returns the original value when it cannot be safely reduced.
 */
export function fitTextToRtkBudget(text, budgetTokens) {
  const original = typeof text === "string" ? text : String(text || "");
  const beforeTokens = estimateRtkTokens(original);
  const budget = normalizeRtkBudgetTokens(budgetTokens);

  if (beforeTokens <= budget) {
    return { text: original, beforeTokens, afterTokens: beforeTokens, truncated: false };
  }

  const lines = original.split("\n");
  if (lines.length < 3) {
    return {
      text: original,
      beforeTokens,
      afterTokens: beforeTokens,
      truncated: false,
      reason: "not_line_oriented",
    };
  }

  let low = 1;
  let high = lines.length - 1;
  let best = null;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = buildCandidate(lines, middle, lines.length);
    const afterTokens = estimateRtkTokens(candidate);

    if (afterTokens <= budget) {
      best = { text: candidate, beforeTokens, afterTokens, truncated: true };
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (!best || best.text.length >= original.length) {
    return {
      text: original,
      beforeTokens,
      afterTokens: beforeTokens,
      truncated: false,
      reason: "budget_too_small",
    };
  }

  return best;
}
