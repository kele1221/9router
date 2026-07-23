import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("handleChatCore upstream error normalization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the original error JSON with status 429", async () => {
    const bodyText = '{"error":{"message":"请求过于频繁，请稍后重试","type":"rate_limit_exceeded","param":null,"code":"rate_limit_exceeded"}}';
    executeMock.mockResolvedValue({
      response: new Response(bodyText, {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
      url: "https://provider.example/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });

    const result = await handleChatCore({
      body: {
        model: "gpt-4o",
        stream: false,
        messages: [{ role: "user", content: "hello" }],
      },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      connectionId: "test-connection",
      rtkEnabled: false,
      headroomEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      pxpipeEnabled: false,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: {},
        headers: { accept: "application/json" },
      },
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        errorLine: vi.fn(),
      },
    });

    expect(result.status).toBe(429);
    expect(result.response.status).toBe(429);
    expect(await result.response.text()).toBe(bodyText);
  });

  it("does not change the existing response-body behavior for ordinary 400 errors", async () => {
    const bodyText = '{"error":{"message":"bad input","type":"invalid_request_error","upstreamOnly":true}}';
    executeMock.mockResolvedValue({
      response: new Response(bodyText, {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
      url: "https://provider.example/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });

    const result = await handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      connectionId: "test-connection",
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), errorLine: vi.fn() },
    });

    expect(result.status).toBe(400);
    expect(await result.response.text()).not.toContain("upstreamOnly");
  });
});
