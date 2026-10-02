import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("undici", () => ({
  Agent: class { constructor(options) { this.options = options; } },
  ProxyAgent: class { constructor(options) { this.options = options; } },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("fork TLS verification defaults", () => {
  it.each([undefined, "true", "1", "invalid"])("rejects invalid certificates with STRICT_SSL=%s", async (setting) => {
    vi.resetModules();
    for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]) vi.stubEnv(name, "");
    vi.stubEnv("STRICT_SSL", setting);
    const failure = Object.assign(new Error("certificate verification failed"), { cause: { code: "CERT_HAS_EXPIRED" } });
    const fetchMock = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal("fetch", fetchMock);
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    await expect(proxyAwareFetch("https://api.example.test/v1/chat", {})).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["false", "0"])("allows certificate fallback only with explicit STRICT_SSL=%s", async (setting) => {
    vi.resetModules();
    for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]) vi.stubEnv(name, "");
    vi.stubEnv("STRICT_SSL", setting);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = Object.assign(new Error("certificate verification failed"), { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } });
    const response = new Response("ok");
    const fetchMock = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    await expect(proxyAwareFetch("https://api.example.test/v1/chat", {})).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].dispatcher.options.connect.rejectUnauthorized).toBe(false);
  });
});
