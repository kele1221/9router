import { describe, it, expect } from "vitest";
import { compressMessages } from "../../open-sse/rtk/index.js";
import {
  estimateRtkTokens,
  fitTextToRtkBudget,
} from "../../open-sse/rtk/budget.js";

function makeLongDiff() {
  const lines = [
    "diff --git a/src/app.js b/src/app.js",
    "index abc..def 100644",
    "--- a/src/app.js",
    "+++ b/src/app.js",
    "@@ -1,3 +1,200 @@",
  ];
  for (let i = 0; i < 200; i++) {
    lines.push(`+const value${i} = "added line ${i} with padding padding padding";`);
  }
  return lines.join("\n");
}

describe("RTK budget mode", () => {
  it("fits line-oriented output while retaining both ends", () => {
    const input = Array.from({ length: 300 }, (_, i) => `line-${i} ${"x".repeat(20)}`).join("\n");
    const result = fitTextToRtkBudget(input, 128);

    expect(result.truncated).toBe(true);
    expect(result.afterTokens).toBeLessThanOrEqual(128);
    expect(result.text).toContain("line-0");
    expect(result.text).toContain("line-299");
    expect(result.text).toContain("RTK budget truncated");
  });

  it("records budget metrics for a structured tool result", () => {
    const body = { messages: [{ role: "tool", content: makeLongDiff() }] };
    const stats = compressMessages(body, true, { mode: "budget", budgetTokens: 128 });
    const text = body.messages[0].content;

    expect(stats.mode).toBe("budget");
    expect(stats.budgetTokens).toBe(128);
    expect(stats.budgetTruncated).toBeGreaterThan(0);
    expect(stats.tokensAfterEst).toBeLessThanOrEqual(stats.tokensBeforeEst);
    expect(estimateRtkTokens(text)).toBeLessThanOrEqual(128);
    expect(text).toContain("src/app.js");
  });

  it("fails open for an unrecognized single-line payload", () => {
    const original = "a".repeat(5000);
    const body = { messages: [{ role: "tool", content: original }] };
    const stats = compressMessages(body, true, { mode: "budget", budgetTokens: 128 });

    expect(body.messages[0].content).toBe(original);
    expect(stats.budgetTruncated).toBe(0);
    expect(stats.budgetBypassReasons.unrecognized).toBe(1);
  });

  it("preserves error tool results in budget mode", () => {
    const original = makeLongDiff();
    const body = {
      messages: [{ role: "tool", content: original, is_error: true }],
    };
    const stats = compressMessages(body, true, { mode: "budget", budgetTokens: 128 });

    expect(body.messages[0].content).toBe(original);
    expect(stats.hits).toHaveLength(0);
  });
});
