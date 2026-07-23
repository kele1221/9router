import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  handleChatCore: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
}));

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(async () => {}),
  checkAndRefreshToken: mocks.checkAndRefreshToken,
}));

vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("@/lib/pxpipe/loader.js", () => ({
  getTransform: vi.fn(async () => null),
}));

vi.mock("@/lib/pxpipe/events.js", () => ({
  appendPxpipeEvent: vi.fn(),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

describe("chat credential fallback error response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({
      provider: "openai-compatible-chat-test",
      model: "glm-5.2",
    });
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 2000 });
  });

  it("locks on the normalized 429 and returns the unchanged last upstream body", async () => {
    const bodyText = '{"error":{"message":"请求过于频繁，请稍后重试","type":"rate_limit_exceeded","param":null,"code":"rate_limit_exceeded"}}';
    const credentials = {
      connectionId: "connection-1",
      connectionName: "sto",
      providerSpecificData: {},
    };
    mocks.getProviderCredentials
      .mockResolvedValueOnce(credentials)
      .mockResolvedValueOnce({
        allRateLimited: true,
        retryAfter: new Date(Date.now() + 2000).toISOString(),
        retryAfterHuman: "reset after 2s",
        lastError: "请求过于频繁，请稍后重试",
        lastErrorCode: 429,
      });
    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 429,
      error: "请求过于频繁，请稍后重试",
      response: new Response(bodyText, {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    });

    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai-compatible-chat-test/glm-5.2",
        stream: false,
        messages: [{ role: "user", content: "hello" }],
      }),
    }));

    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "connection-1",
      429,
      "请求过于频繁，请稍后重试",
      "openai-compatible-chat-test",
      "glm-5.2",
      undefined,
    );
    expect(response.status).toBe(429);
    expect(await response.text()).toBe(bodyText);
  });
});
