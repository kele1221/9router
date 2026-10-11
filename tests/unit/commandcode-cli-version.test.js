/**
 * Guards the CommandCode CLI version claim.
 *
 * The registry used to hardcode `x-command-code-version: "0.25.7"` while the
 * published CLI was already 1.79.2. The upstream usage payload shape changed
 * v5 -> v6 across those releases, so a stale claim hides compatibility drift —
 * the exact class of bug that silently zeroed CommandCode's cache tokens.
 *
 * The version now lives in one constant. These tests assert the wire header
 * actually uses it and that it is a real semver, so the two cannot drift apart.
 */
import { describe, it, expect } from "vitest";
import { COMMANDCODE_CLI_VERSION } from "../../open-sse/providers/shared.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

// NOTE: PROVIDERS flattens the registry's `transport` block onto the provider
// entry, so the headers live at PROVIDERS.commandcode.headers (there is no
// `.transport` key at runtime).
const ccHeaders = PROVIDERS.commandcode.headers;

describe("CommandCode CLI version wiring", () => {
  it("sends the shared constant in the version header (AC1)", () => {
    expect(ccHeaders["x-command-code-version"]).toBe(COMMANDCODE_CLI_VERSION);
  });

  it("is a plain semver string, not a range or placeholder (AC2)", () => {
    expect(COMMANDCODE_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is past the 0.25.x line that predated the v6 usage shape (AC2)", () => {
    const [major, minor] = COMMANDCODE_CLI_VERSION.split(".").map(Number);
    // 0.25.7 was the stale pin; the current CLI is 1.x
    expect(major).toBeGreaterThanOrEqual(1);
    expect(minor).toBeGreaterThanOrEqual(0);
  });

  it("keeps the cli environment header unchanged (AC4)", () => {
    expect(ccHeaders["x-cli-environment"]).toBe("cli");
  });

  it("does not affect other providers' version headers (AC6)", () => {
    // claude has its own constant and must not follow the commandcode value
    const claudeUA = PROVIDERS.claude?.headers?.["User-Agent"] || "";
    if (claudeUA) expect(claudeUA).not.toContain(COMMANDCODE_CLI_VERSION);
  });
});
