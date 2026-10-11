/**
 * Regression tests for the CommandCode usage extractor cache mapping.
 *
 * Background: CommandCode's /alpha/generate streams AI SDK NDJSON, so its usage
 * object used a different naming convention than every other provider and the
 * cache fields were being dropped — cached_tokens was 0 for all 3,489 historical
 * requests, which also caused cache-hit tokens to be billed at the full input
 * rate (pricing.js subtracts cached_tokens to apply the cached rate).
 *
 * Two upstream shapes must both be understood:
 *   v5 flat:   { inputTokens, outputTokens, totalTokens, cachedInputTokens }
 *   v6 nested: { inputTokens:{total,noCache,cacheRead,cacheWrite}, inputTokenDetails:{...} }
 *
 * Critical invariant under test: cache counts are a SUBSET of prompt_tokens and
 * must never be added to it (the opposite of the claude() extractor).
 */
import { describe, it, expect } from "vitest";
import { toOpenAIUsage } from "../../open-sse/translator/concerns/usage.js";

describe("USAGE_EXTRACTORS.commandcode — cache field mapping", () => {
  it("maps v5 flat cachedInputTokens without inflating prompt_tokens (AC1)", () => {
    const usage = toOpenAIUsage(
      { inputTokens: 75000, outputTokens: 400, totalTokens: 75400, cachedInputTokens: 72000 },
      "commandcode",
    );

    expect(usage.prompt_tokens).toBe(75000); // NOT 147000 — cache is a subset
    expect(usage.completion_tokens).toBe(400);
    expect(usage.total_tokens).toBe(75400);
    expect(usage.prompt_tokens_details.cached_tokens).toBe(72000);
  });

  it("maps v6 nested shape identically to the v5 flat shape (AC2)", () => {
    const v5 = toOpenAIUsage(
      { inputTokens: 75000, outputTokens: 400, totalTokens: 75400, cachedInputTokens: 72000 },
      "commandcode",
    );
    const v6 = toOpenAIUsage(
      {
        inputTokens: { total: 75000, noCache: 3000, cacheRead: 72000, cacheWrite: 0 },
        outputTokens: { total: 400, text: 320, reasoning: 80 },
        inputTokenDetails: { cacheReadTokens: 72000, cacheWriteTokens: 0 },
      },
      "commandcode",
    );

    expect(v6).toEqual(v5);
  });

  it("understands DeepSeek's native prompt_cache_hit_tokens fallback", () => {
    const usage = toOpenAIUsage(
      { inputTokens: 10000, outputTokens: 50, totalTokens: 10050, prompt_cache_hit_tokens: 8192 },
      "commandcode",
    );
    expect(usage.prompt_tokens_details.cached_tokens).toBe(8192);
    expect(usage.prompt_tokens).toBe(10000);
  });

  it("maps cache-write counts to cache_creation_tokens", () => {
    const v6 = toOpenAIUsage(
      {
        inputTokens: { total: 20000, noCache: 20000, cacheRead: 0, cacheWrite: 5000 },
        outputTokens: { total: 100, text: 100, reasoning: 0 },
        inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 5000 },
      },
      "commandcode",
    );
    expect(v6.prompt_tokens_details.cache_creation_tokens).toBe(5000);
    // cache read was 0, so it must not appear as a bogus 0-valued key
    expect(v6.prompt_tokens_details.cached_tokens).toBeUndefined();
  });

  it("preserves the pre-fix output exactly when no cache fields are present (AC3)", () => {
    // This is the byte-for-byte output of the previous implementation. Kept literal
    // so an accidental change to the no-cache path fails loudly.
    const usage = toOpenAIUsage(
      { inputTokens: 7596, outputTokens: 9, totalTokens: 7605 },
      "commandcode",
    );
    expect(usage).toEqual({ prompt_tokens: 7596, completion_tokens: 9, total_tokens: 7605 });
  });

  it("handles a v5 flat payload with no totalTokens by summing parts", () => {
    const usage = toOpenAIUsage({ inputTokens: 100, outputTokens: 7 }, "commandcode");
    expect(usage).toEqual({ prompt_tokens: 100, completion_tokens: 7, total_tokens: 107 });
  });

  it("does not produce negative or NaN values for malformed input", () => {
    const usage = toOpenAIUsage(
      { inputTokens: 100, outputTokens: 5, cachedInputTokens: 999999 },
      "commandcode",
    );
    expect(Number.isFinite(usage.prompt_tokens)).toBe(true);
    expect(usage.prompt_tokens).toBeGreaterThanOrEqual(0);
    expect(usage.prompt_tokens_details.cached_tokens).toBe(999999);
  });

  it("does not report reasoning_tokens (avoids double-charging output)", () => {
    const usage = toOpenAIUsage(
      {
        inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 400, text: 320, reasoning: 80 },
        inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      "commandcode",
    );
    expect(usage.completion_tokens_details).toBeUndefined();
  });
});
