import { describe, it, expect } from "vitest";
import { summarizeLatest } from "../../src/app/(dashboard)/dashboard/network/constants.js";

const s = (kind, ok, over = {}) => ({
  kind, ok, target: `${kind}-t`, rttAvgMs: ok ? 20 : null,
  lossPct: kind === "icmp" ? (ok ? 0 : 100) : null, ...over,
});

describe("summarizeLatest", () => {
  it("returns an empty summary for no rows", () => {
    expect(summarizeLatest({})).toMatchObject({ total: 0, transportOk: null, icmpFiltered: false });
  });

  it("counts transport probes separately from ICMP", () => {
    const s1 = summarizeLatest({
      a: s("icmp", true), b: s("tcp", true), c: s("dns", true),
    });
    expect(s1.transportTotal).toBe(2);
    expect(s1.transportOkCount).toBe(2);
    expect(s1.icmpFiltered).toBe(false);
  });

  // The real-machine case: all ICMP dropped, every transport probe fine.
  it("flags ICMP filtering when ICMP fails but all transport probes pass", () => {
    const out = summarizeLatest({
      a: s("icmp", false), b: s("icmp", false),
      c: s("tcp", true), d: s("dns", true),
    });
    expect(out.icmpFiltered).toBe(true);
    expect(out.icmpLossMaxPct).toBe(100);
    expect(out.transportOk).toBe(true);
  });

  it("does NOT flag filtering when transport also fails", () => {
    const out = summarizeLatest({
      a: s("icmp", false), b: s("tcp", false),
    });
    expect(out.icmpFiltered).toBe(false);
    expect(out.transportOk).toBe(false);
  });

  it("does not flag filtering when one ICMP target is merely slow, not lossy", () => {
    // Both targets answer, with negligible loss — nothing to explain away.
    const out = summarizeLatest({
      a: s("icmp", true, { lossPct: 0 }), b: s("icmp", true, { lossPct: 0 }), c: s("tcp", true),
    });
    expect(out.icmpFiltered).toBe(false);
  });

  it("excludes env change events from the counts", () => {
    const out = summarizeLatest({
      a: s("icmp", true), e: { kind: "env", ok: true, target: "env", rttAvgMs: null, lossPct: null },
    });
    expect(out.total).toBe(1);
  });
});

describe("partial ICMP loss (the real-machine case)", () => {
  it("flags filtering when one ICMP target answers with heavy loss", () => {
    const out = summarizeLatest({
      a: s("icmp", false),
      b: s("icmp", true, { lossPct: 66, rttAvgMs: 83 }),
      c: s("tcp", true), d: s("dns", true),
    });
    expect(out.icmpFiltered).toBe(true);
    expect(out.icmpLossMaxPct).toBe(100);
  });

  it("does not flag filtering for light ICMP loss", () => {
    const out = summarizeLatest({
      a: s("icmp", true, { lossPct: 5 }), b: s("tcp", true),
    });
    expect(out.icmpFiltered).toBe(false);
  });

  it("does not flag filtering when transport is only partly healthy", () => {
    const out = summarizeLatest({
      a: s("icmp", false), b: s("tcp", true), c: s("dns", false),
    });
    expect(out.icmpFiltered).toBe(false);
  });
});
