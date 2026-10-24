// Regression: a MODEL-level error (the upstream does not recognise the model id)
// used to be read through checkFallbackError, which conflates two different
// questions. A stale combo member therefore failed the whole turn, because
// "model not found" / "unsupported model name" answer shouldFallback=false;
// and a 404 additionally locked a perfectly healthy account for 2 minutes.
//
// The fix splits the decision:
//   checkFallbackError  → "should this ACCOUNT be cooled down?"  (still false here)
//   shouldTryNextModel  → "should this COMBO try its next model?" (true here)
import { describe, expect, it } from "vitest";
import { checkFallbackError, shouldTryNextModel } from "../../open-sse/services/accountFallback.js";
import { isModelLevelError } from "../../open-sse/config/errorConfig.js";

// The exact upstream wording from the reported failure.
const DEEPSEEK_MODEL_ID_ERROR =
  "The supported API model names are deepseek-flash, deepseek-v4-pro, " +
  "but you passed deepseek-v4.1-flash.";

const MODEL_NOT_FOUND = JSON.stringify({ error: "model not found", success: false });

describe("model-level errors do not cool the account down", () => {
  it("keeps the account healthy for a rejected DeepSeek model id (400)", () => {
    const result = checkFallbackError(400, DEEPSEEK_MODEL_ID_ERROR, 0, "deepseek");

    expect(result.shouldFallback).toBe(false);
    expect(result.cooldownMs).toBe(0);
    expect(result.modelScoped).toBe(true);
  });

  it("keeps the account healthy for 'model not found' (404)", () => {
    // Previously { shouldFallback: true, cooldownMs: 120000 }, which wrote a
    // modelLock_* on the connection over a stale registry entry.
    const result = checkFallbackError(404, MODEL_NOT_FOUND, 0, "clinepass");

    expect(result.shouldFallback).toBe(false);
    expect(result.cooldownMs).toBe(0);
    expect(result.modelScoped).toBe(true);
  });

  it("recognizes the marker set without over-reaching", () => {
    expect(isModelLevelError(400, DEEPSEEK_MODEL_ID_ERROR)).toBe(true);
    expect(isModelLevelError(404, MODEL_NOT_FOUND)).toBe(true);
    expect(isModelLevelError(422, "invalid model id")).toBe(true);

    // Not model-level: a request-scoped 400 and a server error.
    expect(isModelLevelError(400, "maximum context length is 1048576 tokens")).toBe(false);
    expect(isModelLevelError(500, "model not found")).toBe(false);
    // 429 keeps its rate-limit semantics even if the text mentions a model.
    expect(isModelLevelError(429, "model not found")).toBe(false);
  });
});

describe("combos advance past a model-level error", () => {
  it("tries the next model for both model-level shapes", () => {
    expect(shouldTryNextModel(400, DEEPSEEK_MODEL_ID_ERROR, 0, "deepseek")).toBe(true);
    expect(shouldTryNextModel(404, MODEL_NOT_FOUND, 0, "clinepass")).toBe(true);
  });

  it("still refuses to advance for a request-scoped 400", () => {
    // Context overflow is the request's fault — another model with the same
    // window will fail identically, so advancing would only mask the cause.
    expect(shouldTryNextModel(400, "maximum context length is 1048576 tokens")).toBe(false);
  });

  it("keeps advancing for account-scoped and transient failures", () => {
    for (const [status, text] of [[401, "nope"], [402, "insufficient credits"], [403, "forbidden"], [429, "rate limit exceeded"], [503, "upstream exploded"]]) {
      expect(shouldTryNextModel(status, text)).toBe(true);
    }
  });
});

describe("account-scoped rules keep priority over the model-level check", () => {
  it("still cools the account for the codex ChatGPT-account rule", () => {
    // ERROR_RULES[0] is a text rule matched before the model-level check. Its
    // wording contains "model is not supported", which must NOT be treated as a
    // model-level marker or this 30-minute cooldown would silently disappear.
    const result = checkFallbackError(
      400,
      "model is not supported when using codex with a chatgpt account",
      0,
      "codex",
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(1800000);
    expect(result.modelScoped).toBeUndefined();
  });

  it("still honours rate-limit wording on a 4xx", () => {
    expect(checkFallbackError(400, "rate limit reached").shouldFallback).toBe(true);
    expect(checkFallbackError(422, "quota exceeded").shouldFallback).toBe(true);
  });
});

describe("unchanged account-scoped statuses", () => {
  it("preserves the original shouldFallback value for 401/402/403/429", () => {
    for (const status of [401, 402, 403, 429]) {
      expect(checkFallbackError(status, "nope").shouldFallback).toBe(true);
    }
  });

  it("preserves the request-scoped 400 no-cooldown behaviour", () => {
    const result = checkFallbackError(400, "This model's maximum context length is 1048576 tokens.");

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });
});

// clinepass surfaces an empty model completion as HTTP 500
// {"error":"empty response content","success":false} — a transient content hiccup,
// not a credential/quota problem. Previously this hit the default transient branch
// and locked the (often only) connection for 30s, so the very next turns returned
// 503 "reset after Xs" even though the upstream had already recovered. The rule
// keeps shouldFallback (combos still advance) but uses the short 5s cooldown.
describe("empty-response-content 500: short cooldown, combo still advances", () => {
  const EMPTY_CONTENT_500 = '[500]: {"error":"empty response content","success":false}';

  it("uses the short (5s) cooldown, not the 30s transient default", () => {
    const result = checkFallbackError(500, EMPTY_CONTENT_500, 0, "clinepass");
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(5_000);
  });

  it("still lets a combo advance to its next model", () => {
    expect(shouldTryNextModel(500, EMPTY_CONTENT_500, 0, "clinepass")).toBe(true);
  });

  it("a plain 500 (no marker) keeps the longer transient default", () => {
    const result = checkFallbackError(500, "internal server error", 0, "clinepass");
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(5_000);
  });
});
