import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// agent.api5.cursor.sh is HTTP/2-only, so the service talks to node:http2
// instead of fetch — stub the client and record request headers.
const http2State = vi.hoisted(() => ({ connect: vi.fn(), lastRequest: null }));
vi.mock("http2", () => ({
  default: { connect: (...a) => http2State.connect(...a) },
  connect: (...a) => http2State.connect(...a),
}));

import {
  clearCursorModelCache,
  parseCursorUsableModels,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";

// Minimal stand-in for an http2 ClientHttp2Session carrying a unary response.
function fakeClient({ status = 200, body = Buffer.alloc(0), error = null } = {}) {
  const req = new EventEmitter();
  req.end = () => {
    queueMicrotask(() => {
      if (error) return req.emit("error", error);
      req.emit("response", { ":status": status });
      if (body.length) req.emit("data", body);
      req.emit("end");
    });
  };
  const client = new EventEmitter();
  client.request = (headers) => {
    http2State.lastRequest = headers;
    return req;
  };
  client.close = () => {};
  return client;
}

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Uint8Array.from(bytes);
}

function field(fieldNumber, value) {
  return Uint8Array.from([(fieldNumber << 3) | 2, ...varint(value.length), ...value]);
}

function text(value) {
  return new TextEncoder().encode(value);
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function model(id, name) {
  return field(1, concat(field(1, text(id)), field(4, text(name))));
}

describe("Cursor live model catalog", () => {
  beforeEach(() => {
    http2State.connect.mockReset();
    http2State.lastRequest = null;
    clearCursorModelCache();
  });

  afterEach(() => {
    clearCursorModelCache();
  });

  it("decodes the GetUsableModels protobuf response", () => {
    const payload = concat(
      model("default", "Auto"),
      model("gpt-5.3-codex", "GPT 5.3 Codex"),
      model("gpt-5.3-codex", "Duplicate"),
    );

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "default", name: "Auto" },
      { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    ]);
  });

  it("fetches the account-specific catalog and caches it", async () => {
    const payload = concat(model("claude-4.6-opus", "Claude 4.6 Opus"));
    http2State.connect.mockReturnValue(fakeClient({ status: 200, body: Buffer.from(payload) }));
    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });
    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });

    expect(http2State.connect).toHaveBeenCalledTimes(1);
    expect(http2State.connect).toHaveBeenCalledWith("https://agent.api5.cursor.sh");
    expect(http2State.lastRequest).toMatchObject({
      ":method": "POST",
      ":path": "/agent.v1.AgentService/GetUsableModels",
      ":authority": "agent.api5.cursor.sh",
      "content-type": "application/proto",
      accept: "application/proto",
    });
  });

  it("fails open when the Cursor catalog request fails", async () => {
    http2State.connect.mockReturnValue(fakeClient({ status: 403 }));

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
  });
});
