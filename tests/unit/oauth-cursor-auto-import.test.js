import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os
vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock/home") },
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

// Mock child_process so the sqlite3 CLI fallback + `which cursor` are controllable.
const execFileMock = vi.fn();
vi.mock("child_process", () => ({ execFile: (...a) => execFileMock(...a) }));

// Shared mock db instance (better-sqlite3 strategy)
const mockDbInstance = {
  prepare: vi.fn(),
  close: vi.fn(),
  __throwOnConstruct: false,
};

// Mock better-sqlite3 as a class so `new Database(...)` works
vi.mock("better-sqlite3", () => ({
  default: class MockDatabase {
    constructor() {
      if (mockDbInstance.__throwOnConstruct) {
        throw new Error("SQLITE_CANTOPEN");
      }
      return mockDbInstance;
    }
  },
}));

// We need to dynamically import after mocks are registered
let GET;

const MAC_PATH =
  "/mock/home/Library/Application Support/Cursor/User/globalStorage/state.vscdb";
const INSIDERS_PATH =
  "/mock/home/Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb";

// keys → values map so the route's `SELECT value ... .get(key)` queries resolve
const rowsFromMap = (map) => (key) => {
  const value = map[key];
  return value === undefined ? undefined : { value };
};

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbInstance.__throwOnConstruct = false;
    // SQLite CLI fails unless a test opts in.
    execFileMock.mockImplementation((file, args, options, cb) => {
      const done = typeof options === "function" ? options : cb;
      done(new Error("sqlite3: command not found"));
    });
    // Force darwin so macOS-specific logic is exercised
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    // Re-import to pick up fresh mocks each run
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  // ── macOS path probing ────────────────────────────────────────────────

  it("returns not-found when no macOS cursor db paths are accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations:");
    expect(response.body.error).toContain(MAC_PATH);
    expect(response.body.error).toContain(INSIDERS_PATH);
  });

  it("probes the Insiders path when the stable one is missing", async () => {
    vi.mocked(fsPromises.access).mockImplementation(async (p) => {
      if (p === INSIDERS_PATH) return;
      throw new Error("ENOENT");
    });
    mockDbInstance.prepare.mockReturnValue({ get: rowsFromMap({}) });

    const response = await GET();

    expect(fsPromises.access).toHaveBeenCalledWith(MAC_PATH, 4);
    expect(fsPromises.access).toHaveBeenCalledWith(INSIDERS_PATH, 4);
    expect(response.body.found).toBe(false);
    expect(response.body.dbPath).toBe(INSIDERS_PATH);
  });

  // ── Token extraction ──────────────────────────────────────────────────

  it("extracts tokens using exact keys", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      get: rowsFromMap({
        "cursorAuth/accessToken": "test-token",
        "storage.serviceMachineId": "test-machine-id",
      }),
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
    expect(mockDbInstance.close).toHaveBeenCalled();
  });

  it("unwraps JSON-encoded string values", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      get: rowsFromMap({
        "cursorAuth/accessToken": '"json-token"',
        "storage.serviceMachineId": '"json-machine-id"',
      }),
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  it("falls back to the sqlite3 CLI when better-sqlite3 is unavailable", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;
    execFileMock.mockImplementation((file, args, options, cb) => {
      const done = typeof options === "function" ? options : cb;
      const sql = args[1];
      if (sql.includes("cursorAuth/accessToken")) done(null, { stdout: "cli-token\n" });
      else if (sql.includes("storage.serviceMachineId")) done(null, { stdout: '"cli-machine"\n' });
      else done(null, { stdout: "" });
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("cli-token");
    expect(response.body.machineId).toBe("cli-machine");
  });

  it("returns a manual-paste prompt when tokens are missing", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({ get: rowsFromMap({}) });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toBe(MAC_PATH);
  });

  // ── Linux ─────────────────────────────────────────────────────────────

  it("linux reports Cursor as not installed when no CLI/desktop entry exists", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    // Config db present, but no `cursor` binary and no .desktop entry.
    vi.mocked(fsPromises.access).mockImplementation(async (p) => {
      if (String(p).endsWith(".desktop")) throw new Error("ENOENT");
      return undefined;
    });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("does not appear to be installed");
  });

  it("linux reports checked locations when no config db exists", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations:");
    expect(response.body.error).toContain("/mock/home/.config/Cursor/User/globalStorage/state.vscdb");
  });

  // ── Windows / other platforms ─────────────────────────────────────────

  it("unknown platform falls back to the linux-style paths", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("/mock/home/.config/Cursor/User/globalStorage/state.vscdb");
  });
});
