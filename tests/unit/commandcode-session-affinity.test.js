/**
 * Regression tests for CommandCode session-affinity keys (threadId / x-session-id).
 *
 * Upstream pins its server-side prefix cache to a backend node using a session
 * affinity key. Both the request translator and the executor used to generate a
 * fresh randomUUID() per request, so every turn looked like a brand-new session
 * and could land on a cold node — losing the prefix cache (and re-prefilling the
 * whole conversation) that a direct connection would have kept.
 *
 * 9router already resolves a stable session id (credentials._clientSessionId).
 * These tests lock in that it is used, that both sides agree, and that the value
 * is always a UUID — upstream silently drops non-UUID threadIds.
 */
import { describe, it, expect } from "vitest";
import { openaiToCommandCodeRequest } from "../../open-sse/translator/request/openai-to-commandcode.js";
import { CommandCodeExecutor } from "../../open-sse/executors/commandcode.js";
import { toUuidSessionId } from "../../open-sse/utils/sessionManager.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BODY = { messages: [{ role: "user", content: "hi" }] };
const SAMPLE_UUID = "3f8a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b";

describe("toUuidSessionId", () => {
  it("passes a bare uuid through (lowercased)", () => {
    expect(toUuidSessionId(SAMPLE_UUID)).toBe(SAMPLE_UUID);
    expect(toUuidSessionId(SAMPLE_UUID.toUpperCase())).toBe(SAMPLE_UUID);
  });

  it("extracts the uuid from a scoped session id", () => {
    expect(toUuidSessionId(`claude:${SAMPLE_UUID}`)).toBe(SAMPLE_UUID);
    expect(toUuidSessionId(`antigravity:${SAMPLE_UUID}`)).toBe(SAMPLE_UUID);
  });

  it("extracts the uuid from generateBinaryStyleId's <uuid><timestamp> form", () => {
    expect(toUuidSessionId(`${SAMPLE_UUID}1728638400000`)).toBe(SAMPLE_UUID);
  });

  it("derives a deterministic uuid for opaque tokens", () => {
    const a = toUuidSessionId("my-opaque-session-token");
    const b = toUuidSessionId("my-opaque-session-token");
    expect(a).toMatch(UUID_RE);
    expect(a).toBe(b);
    expect(a).not.toBe(toUuidSessionId("a-different-token"));
  });

  it("returns null for unusable input", () => {
    expect(toUuidSessionId("")).toBeNull();
    expect(toUuidSessionId("   ")).toBeNull();
    expect(toUuidSessionId(null)).toBeNull();
    expect(toUuidSessionId(undefined)).toBeNull();
    expect(toUuidSessionId(12345)).toBeNull();
    expect(toUuidSessionId("x".repeat(300))).toBeNull();
  });
});

describe("openaiToCommandCodeRequest — threadId affinity", () => {
  it("reuses the resolved session id across turns (AC4)", () => {
    const credentials = { _clientSessionId: SAMPLE_UUID };
    const first = openaiToCommandCodeRequest("m", BODY, true, credentials);
    const second = openaiToCommandCodeRequest("m", BODY, true, credentials);

    expect(first.threadId).toBe(SAMPLE_UUID);
    expect(second.threadId).toBe(first.threadId);
  });

  it("isolates different sessions from each other (AC4)", () => {
    const a = openaiToCommandCodeRequest("m", BODY, true, { _clientSessionId: SAMPLE_UUID });
    const b = openaiToCommandCodeRequest("m", BODY, true, {
      _clientSessionId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    });
    expect(a.threadId).not.toBe(b.threadId);
  });

  it("strips the scope prefix so upstream does not drop the value (AC5)", () => {
    const out = openaiToCommandCodeRequest("m", BODY, true, {
      _clientSessionId: `claude:${SAMPLE_UUID}`,
    });
    expect(out.threadId).toBe(SAMPLE_UUID);
    expect(out.threadId).toMatch(UUID_RE);
    expect(out.threadId).not.toContain(":");
  });

  it("keeps affinity for opaque session tokens instead of degrading to random (AC5)", () => {
    const creds = { _clientSessionId: "opaque-token-abc" };
    const first = openaiToCommandCodeRequest("m", BODY, true, creds);
    const second = openaiToCommandCodeRequest("m", BODY, true, creds);
    expect(first.threadId).toMatch(UUID_RE);
    expect(second.threadId).toBe(first.threadId);
  });

  it("falls back to a valid uuid when no session is available (AC4)", () => {
    expect(openaiToCommandCodeRequest("m", BODY, true, undefined).threadId).toMatch(UUID_RE);
    expect(openaiToCommandCodeRequest("m", BODY, true, {}).threadId).toMatch(UUID_RE);
    // still unique per call in the fallback path
    expect(openaiToCommandCodeRequest("m", BODY, true, {}).threadId)
      .not.toBe(openaiToCommandCodeRequest("m", BODY, true, {}).threadId);
  });

  it("still works with the 3-argument call used by the validate route (AC9)", () => {
    const out = openaiToCommandCodeRequest("deepseek/deepseek-v4.1-flash", BODY, false);
    expect(out.threadId).toMatch(UUID_RE);
    expect(out.params.stream).toBe(false);
  });
});

describe("CommandCodeExecutor.buildHeaders — x-session-id agreement", () => {
  const executor = new CommandCodeExecutor();

  it("echoes the body threadId so both headers agree (AC6)", () => {
    const headers = executor.buildHeaders({ apiKey: "user_test" }, true, "url", "model", {
      threadId: SAMPLE_UUID,
    });
    expect(headers["x-session-id"]).toBe(SAMPLE_UUID);
  });

  it("agrees with the translator for one request end-to-end (AC6)", () => {
    const credentials = { apiKey: "user_test", _clientSessionId: `claude:${SAMPLE_UUID}` };
    const translated = openaiToCommandCodeRequest("m", BODY, true, credentials);
    const headers = executor.buildHeaders(credentials, true, "url", "m", translated);

    expect(headers["x-session-id"]).toBe(translated.threadId);
    expect(headers["x-session-id"]).toBe(SAMPLE_UUID);
  });

  it("normalizes a non-uuid body threadId rather than forwarding it", () => {
    const headers = executor.buildHeaders({ apiKey: "k" }, true, "url", "m", {
      threadId: "claude:" + SAMPLE_UUID,
    });
    expect(headers["x-session-id"]).toBe(SAMPLE_UUID);
  });

  it("falls back to the credential session, then a uuid (AC4)", () => {
    expect(executor.buildHeaders({ _clientSessionId: SAMPLE_UUID }, true)["x-session-id"])
      .toBe(SAMPLE_UUID);
    expect(executor.buildHeaders({}, true)["x-session-id"]).toMatch(UUID_RE);
    expect(executor.buildHeaders({}, true, "url", "m", null)["x-session-id"]).toMatch(UUID_RE);
  });

  it("still sets auth and stream headers", () => {
    const headers = executor.buildHeaders({ apiKey: "user_abc" }, true, "url", "m", null);
    expect(headers.Authorization).toBe("Bearer user_abc");
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
