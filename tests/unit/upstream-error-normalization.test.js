import { describe, expect, it } from "vitest";
import * as errorUtils from "../../open-sse/utils/error.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("upstream rate-limit error normalization", () => {
  it("maps a mislabeled 400 rate_limit_exceeded response to 429", () => {
    const bodyText = JSON.stringify({
      error: {
        message: "请求过于频繁，请稍后重试",
        type: "rate_limit_exceeded",
        param: null,
        code: "rate_limit_exceeded",
      },
    });

    expect(errorUtils.normalizeUpstreamErrorStatus(400, bodyText)).toBe(429);
  });

  it.each([
    [{ error: { code: "rate_limit_exceeded" } }, 429],
    [{ error: { type: "rate_limit_exceeded" } }, 429],
    [{ error: { code: "invalid_request_error", type: "invalid_request_error" } }, 400],
  ])("requires an exact structured rate-limit marker", (payload, expected) => {
    expect(errorUtils.normalizeUpstreamErrorStatus(400, JSON.stringify(payload))).toBe(expected);
  });

  it("keeps malformed and non-400 responses unchanged", () => {
    expect(errorUtils.normalizeUpstreamErrorStatus(400, "not-json")).toBe(400);
    expect(errorUtils.normalizeUpstreamErrorStatus(429, JSON.stringify({
      error: { code: "rate_limit_exceeded" },
    }))).toBe(429);
  });

  it("normalizes the status returned by parseUpstreamError before routing decisions", async () => {
    const bodyText = JSON.stringify({
      error: {
        message: "请求过于频繁，请稍后重试",
        type: "rate_limit_exceeded",
        code: "rate_limit_exceeded",
      },
    });
    const response = new Response(bodyText, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

    const parsed = await errorUtils.parseUpstreamError(response);

    expect(parsed.statusCode).toBe(429);
    expect(parsed.originalStatusCode).toBe(400);
  });

  it("keeps the 429 normalization authoritative over executor error parsing", async () => {
    const response = new Response(JSON.stringify({
      error: { type: "rate_limit_exceeded", message: "slow down" },
    }), { status: 400 });
    const executor = {
      parseError: () => ({ status: 500, message: "executor message" }),
    };

    const parsed = await errorUtils.parseUpstreamError(response, executor);

    expect(parsed.statusCode).toBe(429);
    expect(parsed.preserveBody).toBe(true);
  });

  it("retains the exact upstream body for the client response", async () => {
    const bodyText = '{"error":{"message":"请求过于频繁，请稍后重试","type":"rate_limit_exceeded","param":null,"code":"rate_limit_exceeded"}}';
    const response = new Response(bodyText, {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });

    const parsed = await errorUtils.parseUpstreamError(response);

    expect(parsed.bodyText).toBe(bodyText);
    expect(parsed.contentType).toBe("application/json; charset=utf-8");
  });

  it("returns the unchanged upstream JSON with the normalized HTTP status", async () => {
    const bodyText = '{"error":{"message":"请求过于频繁，请稍后重试","type":"rate_limit_exceeded","param":null,"code":"rate_limit_exceeded"}}';

    const result = errorUtils.createErrorResult(429, "internal context", undefined, {
      bodyText,
      contentType: "application/json; charset=utf-8",
    });

    expect(result.status).toBe(429);
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await result.response.text()).toBe(bodyText);
  });

  it("selects the 429 exponential backoff instead of the default 30 second lock", async () => {
    const parsed = await errorUtils.parseUpstreamError(new Response(JSON.stringify({
      error: { code: "rate_limit_exceeded" },
    }), { status: 400 }));

    const fallback = checkFallbackError(parsed.statusCode, parsed.message, 0);

    expect(fallback.cooldownMs).toBe(2000);
    expect(fallback.newBackoffLevel).toBe(1);
  });
});
