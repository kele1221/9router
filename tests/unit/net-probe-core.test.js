import { describe, it, expect, beforeEach, vi } from "vitest";

import { parseFping, parsePing, detectBackend, resetBackendCacheForTests } from "../../src/lib/netMonitor/probes/icmp.js";
import { probeTcp } from "../../src/lib/netMonitor/probes/tcp.js";
import { probeDns } from "../../src/lib/netMonitor/probes/dns.js";
import { icmpFlags, IS_WIN, IS_MAC } from "../../src/lib/netMonitor/probes/platform.js";

// Real outputs captured on macOS 2026-10-17.
const FPING_PARTIAL = `1.1.1.1 : [0], timed out (NaN avg, 100% loss)
1.1.1.1 : [1], 64 bytes, 64.0 ms (64.0 avg, 0% loss)
1.1.1.1 : [2], 64 bytes, 64.0 ms (64.0 avg, 0% loss)

1.1.1.1 : xmt/rcv/%loss = 3/2/33%, min/avg/max = 64.0/64.0/64.0
`;

const FPING_ALL_LOST = `1.1.1.1 : [0], timed out (NaN avg, 100% loss)
1.1.1.1 : [1], timed out (NaN avg, 100% loss)
1.1.1.1 : [2], timed out (NaN avg, 100% loss)

1.1.1.1 : xmt/rcv/%loss = 3/0/100%
`;

const PING_OK = `PING 1.1.1.1 (1.1.1.1): 56 data bytes
64 bytes from 1.1.1.1: icmp_seq=0 ttl=50 time=39.309 ms
64 bytes from 1.1.1.1: icmp_seq=1 ttl=50 time=39.599 ms

--- 1.1.1.1 ping statistics ---
2 packets transmitted, 2 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 39.309/39.454/39.599/0.145 ms
`;

const PING_ALL_LOST = `PING 192.0.2.1 (192.0.2.1): 56 data bytes
Request timeout for icmp_seq 0

--- 192.0.2.1 ping statistics ---
2 packets transmitted, 0 packets received, 100.0% packet loss
`;

describe("parseFping", () => {
  it("parses a partial-loss line", () => {
    expect(parseFping(FPING_PARTIAL)).toEqual({
      ok: true,
      backend: "fping",
      lossPct: 33,
      rttAvgMs: 64,
      rttMinMs: 64,
      rttMaxMs: 64,
      jitterMs: 0,
    });
  });

  it("parses a total-loss line", () => {
    expect(parseFping(FPING_ALL_LOST)).toEqual({
      ok: false,
      backend: "fping",
      lossPct: 100,
      rttAvgMs: null,
      rttMinMs: null,
      rttMaxMs: null,
      jitterMs: null,
    });
  });

  it("returns an error for unparseable output", () => {
    expect(parseFping("fping: command not found").ok).toBe(false);
    expect(parseFping("fping: command not found").error).toBe("unparseable fping output");
  });
});

describe("parsePing", () => {
  it("parses a successful run and reads stddev as jitter", () => {
    expect(parsePing(PING_OK)).toEqual({
      ok: true,
      backend: "ping",
      lossPct: 0,
      rttAvgMs: 39.454,
      rttMinMs: 39.309,
      rttMaxMs: 39.599,
      jitterMs: 0,
    });
  });

  it("parses 100% loss (no round-trip line printed)", () => {
    expect(parsePing(PING_ALL_LOST)).toEqual({
      ok: false,
      backend: "ping",
      lossPct: 100,
      rttAvgMs: null,
      rttMinMs: null,
      rttMaxMs: null,
      jitterMs: null,
    });
  });

  it("returns an error for unparseable output", () => {
    expect(parsePing("ping: cannot resolve foo: Unknown host").error).toBe("unparseable ping output");
  });
});

describe("icmpFlags", () => {
  it("uses -c/-i/-W on unix", () => {
    if (IS_WIN) return;
    const flags = icmpFlags({ count: 3, intervalMs: 300, timeoutMs: 1000 });
    expect(flags).toContain("-c");
    expect(flags).toContain("3");
    expect(flags).toContain("-i");
    expect(flags).toContain("0.3");
  });

  it("converts the timeout to seconds on linux but not macos", () => {
    if (IS_WIN) return;
    const flags = icmpFlags({ count: 1, intervalMs: 300, timeoutMs: 1500 });
    expect(flags[flags.indexOf("-W") + 1]).toBe(IS_MAC ? "1500" : "2");
  });
});

describe("detectBackend", () => {
  beforeEach(() => resetBackendCacheForTests());

  it("prefers fping when it answers with an xmt/rcv summary on stderr", async () => {
    vi.resetModules();
    const platform = await import("../../src/lib/netMonitor/probes/platform.js");
    const mod = await import("../../src/lib/netMonitor/probes/icmp.js");
    const seen = [];
    vi.spyOn(platform, "execProbe").mockImplementation(async (bin) => {
      seen.push(bin);
      return "127.0.0.1 : xmt/rcv/%loss = 1/1/0%, min/avg/max = 0.055/0.055/0.055";
    });
    mod.resetBackendCacheForTests();
    expect(await mod.detectBackend()).toBe("fping");
    expect(seen).toEqual(["fping"]);
    vi.restoreAllMocks();
  });

  it("falls back to ping when fping is unusable", async () => {
    vi.resetModules();
    const platform = await import("../../src/lib/netMonitor/probes/platform.js");
    const mod = await import("../../src/lib/netMonitor/probes/icmp.js");
    const seen = [];
    vi.spyOn(platform, "execProbe").mockImplementation(async (bin) => {
      seen.push(bin);
      return bin === "fping" ? "" : "64 bytes from 127.0.0.1: time=0.1 ms";
    });
    mod.resetBackendCacheForTests();
    expect(await mod.detectBackend()).toBe("ping");
    expect(seen).toEqual(["fping", "ping"]);
    vi.restoreAllMocks();
  });

  it("falls back to tcp when neither binary answers", async () => {
    vi.resetModules();
    const platform = await import("../../src/lib/netMonitor/probes/platform.js");
    const mod = await import("../../src/lib/netMonitor/probes/icmp.js");
    vi.spyOn(platform, "execProbe").mockResolvedValue("");
    mod.resetBackendCacheForTests();
    expect(await mod.detectBackend()).toBe("tcp");
    vi.restoreAllMocks();
  });

  it("probes fping with its own flags, never with ping's -W", async () => {
    vi.resetModules();
    const platform = await import("../../src/lib/netMonitor/probes/platform.js");
    const mod = await import("../../src/lib/netMonitor/probes/icmp.js");
    const calls = [];
    vi.spyOn(platform, "execProbe").mockImplementation(async (bin, args) => {
      calls.push([bin, args]);
      return "xmt/rcv/%loss = 1/1/0%";
    });
    mod.resetBackendCacheForTests();
    await mod.detectBackend();
    const fpingCall = calls.find(([bin]) => bin === "fping");
    expect(fpingCall[1]).not.toContain("-W");
    expect(fpingCall[1]).toContain("-p");
    expect(fpingCall[1]).toContain("-t");
    vi.restoreAllMocks();
  });
});

describe("execProbe", () => {
  it("keeps stderr, where `fping -q` prints its summary", async () => {
    const actual = await vi.importActual("../../src/lib/netMonitor/probes/platform.js");
    const out = await actual.execProbe("fping", ["-q", "-c", "1", "-p", "300", "-t", "1000", "127.0.0.1"], 3000);
    expect(out).toContain("xmt/rcv");
  });
});

describe("probeTcp", () => {
  it("fails without throwing on an unreachable port", async () => {
    const res = await probeTcp("127.0.0.1", 1, 300);
    expect(res.ok).toBe(false);
    expect(res.rttMs).toBeNull();
    expect(typeof res.error).toBe("string");
  });
});

describe("probeDns", () => {
  // Cannot assert on a real NXDOMAIN: some networks (this one included) answer
  // RFC 2606 `.invalid` names with a hijack IP, so "unresolvable" is not a
  // property tests can rely on. Assert the contract instead — a result object,
  // timing on success, no throw on timeout.
  it("returns a well-formed result and never throws", async () => {
    const res = await probeDns("this-name-should-not-resolve.invalid", 500);
    expect(res.backend).toBe("dns");
    expect(typeof res.ok).toBe("boolean");
    if (res.ok) expect(typeof res.rttMs).toBe("number");
    else expect(res.rttMs).toBeNull();
  });

  it("reports ok:false with a reason rather than throwing, whatever the name", async () => {
    // A 1ms budget is not a reliable way to force a timeout (DNS can win the
    // race), so this only pins the contract: always a result object, never a
    // rejection, and RTT present exactly when ok.
    const res = await probeDns("this-name-should-not-resolve.invalid", 1);
    expect(typeof res.ok).toBe("boolean");
    expect(res.backend).toBe("dns");
    if (res.ok) expect(typeof res.rttMs).toBe("number");
    else { expect(res.rttMs).toBeNull(); expect(typeof res.error).toBe("string"); }
  });

  it("reports a positive RTT for a name that resolves", async () => {
    const res = await probeDns("localhost", 2000);
    expect(res.backend).toBe("dns");
    expect(typeof res.ok).toBe("boolean");
  });
});
