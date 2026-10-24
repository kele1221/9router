import { describe, it, expect } from "vitest";

import { attribute, LAYERS, CONFIRMATION_ROUNDS, summarize } from "../../src/lib/netMonitor/attribution.js";

const icmp = (ok, target = "1.1.1.1") => ({ target, kind: "icmp", ok, rttAvgMs: ok ? 40 : null, lossPct: ok ? 0 : 100 });
const tcp = (ok) => ({ target: "1.1.1.1:443", kind: "tcp", ok, rttAvgMs: ok ? 5 : null });
const dns = (ok, target = "github.com") => ({ target, kind: "dns", ok, rttAvgMs: ok ? 12 : null });
const upstream = (ok, target = "openai") => ({ target, kind: "upstream", ok });

const envWith = (over = {}) => ({
  route: { gateway: "192.168.0.1", interface: "en0" },
  dnsServers: ["114.114.114.114"],
  tunnels: [{ name: "utun0" }],
  systemVpn: [],
  egress: { ip: "1.2.3.4" },
  tailscale: null,
  clash: null,
  vpn: { connected: false, suspected: false, via: null },
  ...over,
});

// attribute() requires two consecutive rounds before it reports a verdict
// confidently, so helpers below confirm a scenario before asserting on it.
const confirm = (input) => {
  const first = attribute(input);
  return attribute({ ...input, prev: first });
};

describe("attribution layers", () => {
  it("local: everything fails and the default route is gone", () => {
    const verdict = confirm({
      probes: [icmp(false), icmp(false, "8.8.8.8"), tcp(false)],
      env: envWith({ route: { gateway: null, interface: null } }),
    });
    expect(verdict.layer).toBe(LAYERS.LOCAL);
    expect(verdict.confidence).toBe("high");
    expect(verdict.reasons.join(" ")).toContain("默认路由缺失");
  });

  it("local: frames fail but the link is still up, so confidence is only medium", () => {
    const verdict = confirm({
      probes: [icmp(false), tcp(false)],
      env: envWith(),
    });
    expect(verdict.layer).toBe(LAYERS.LOCAL);
    expect(verdict.confidence).toBe("medium");
  });

  it("dns: packets flow but names do not resolve", () => {
    const verdict = confirm({
      probes: [icmp(true), dns(false), dns(false, "www.google.com")],
      env: envWith(),
    });
    expect(verdict.layer).toBe(LAYERS.DNS);
    expect(verdict.confidence).toBe("high");
    expect(verdict.reasons.join(" ")).toContain("114.114.114.114");
  });

  it("vpn: an observed drop coinciding with degraded connectivity", () => {
    const verdict = confirm({
      probes: [icmp(false), dns(true)],
      env: envWith({ vpn: { connected: false, suspected: false, via: null } }),
      envDiff: { changed: true, fields: [{ field: "vpnConnected", from: true, to: false }] },
    });
    expect(verdict.layer).toBe(LAYERS.VPN);
    expect(verdict.reasons.join(" ")).toContain("VPN 状态由已连接变为未连接");
  });

  it("vpn: does NOT fire on interface presence alone (suspected is not a drop)", () => {
    const verdict = confirm({
      probes: [icmp(true), dns(true)],
      env: envWith({ vpn: { connected: false, suspected: true, via: null } }),
      envDiff: null,
    });
    expect(verdict.layer).not.toBe(LAYERS.VPN);
  });

  it("proxy: controller is up but no node is selected", () => {
    const verdict = confirm({
      probes: [icmp(true), upstream(false)],
      env: envWith({ clash: { present: true, selected: null } }),
    });
    expect(verdict.layer).toBe(LAYERS.PROXY);
    expect(verdict.reasons.join(" ")).toContain("没有选中的节点");
  });

  it("upstream: local network is fine but a provider is unreachable", () => {
    const verdict = confirm({
      probes: [icmp(true), tcp(true), upstream(false, "openai"), upstream(false, "anthropic")],
      env: envWith(),
    });
    expect(verdict.layer).toBe(LAYERS.UPSTREAM);
    expect(verdict.confidence).toBe("high");
    const reasons = verdict.reasons.join(" ");
    expect(reasons).toContain("openai");
    expect(reasons).toContain("anthropic");
  });

  it("unknown: healthy round reports no fault rather than guessing", () => {
    const verdict = confirm({
      probes: [icmp(true), dns(true)],
      env: envWith(),
    });
    expect(verdict.layer).toBe(LAYERS.UNKNOWN);
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(verdict.reasons.join(" ")).toContain("证据不足");
  });

  it("unknown: partial evidence without a clear signal stays unknown", () => {
    const verdict = confirm({
      probes: [icmp(true, "1.1.1.1"), icmp(false, "8.8.8.8")],
      env: envWith(),
    });
    expect(verdict.layer).toBe(LAYERS.UNKNOWN);
  });

  // Observed on the author's own machine: 1.1.1.1 answers TCP:443 in ~6ms and
  // HTTPS 10/10, but drops roughly a third of ICMP echoes. Reporting that as
  // packet loss or a local-network fault would be a false alarm on a connection
  // that works fine for real traffic.
  it("explains ICMP-only failure as filtering rather than a fault", () => {
    const verdict = confirm({
      probes: [icmp(false, "1.1.1.1"), tcp(true), dns(true)],
      env: envWith(),
    });
    expect(verdict.layer).toBe(LAYERS.UNKNOWN);
    expect(verdict.reasons.join(" ")).toContain("ICMP 被限速或过滤");
  });

  // Same machine, second observation: 8.8.8.8 still answers but reports 66%
  // loss while TCP to 1.1.1.1 is 1ms. Partial ICMP loss with a healthy
  // transport layer is filtering too, not degradation.
  it("explains heavy partial ICMP loss as filtering when transport is healthy", () => {
    const heavy = { target: "8.8.8.8", kind: "icmp", ok: true, rttAvgMs: 83, lossPct: 66 };
    const verdict = confirm({
      probes: [icmp(false, "1.1.1.1"), heavy, tcp(true), dns(true)],
      env: envWith(),
    });
    expect(verdict.layer).toBe(LAYERS.UNKNOWN);
    expect(verdict.reasons.join(" ")).toContain("ICMP 被限速或过滤");
  });

  it("does not call light ICMP loss filtering", () => {
    const light = { target: "8.8.8.8", kind: "icmp", ok: true, rttAvgMs: 40, lossPct: 5 };
    const verdict = confirm({
      probes: [icmp(true, "1.1.1.1"), light, tcp(true), dns(true)],
      env: envWith(),
    });
    expect(verdict.reasons.join(" ")).not.toContain("ICMP 被限速或过滤");
  });

  it("still reports a real local fault when transport fails too", () => {
    const verdict = confirm({
      probes: [icmp(false, "1.1.1.1"), tcp(false), dns(false)],
      env: envWith(),
    });
    expect(verdict.layer).toBe(LAYERS.LOCAL);
    expect(verdict.reasons.join(" ")).not.toContain("ICMP 被限速或过滤");
  });
});

describe("confirmation rule", () => {
  it("does not report a fault on the first round", () => {
    const first = attribute({ probes: [icmp(false), tcp(false)], env: envWith() });
    expect(first.layer).toBe(LAYERS.LOCAL);
    expect(first.pending).toBe(true);
    expect(first.confidence).toBe("low");
    expect(first.reasons.join(" ")).toContain("需再确认一轮");
    expect(first.streak).toBe(1);
  });

  it("reports a fault on the second consecutive round", () => {
    const input = { probes: [icmp(false), tcp(false)], env: envWith() };
    const second = attribute({ ...input, prev: attribute(input) });
    expect(second.pending).toBe(false);
    expect(second.streak).toBe(CONFIRMATION_ROUNDS);
  });

  it("resets the streak when evidence points elsewhere", () => {
    const local = attribute({ probes: [icmp(false), tcp(false)], env: envWith() });
    const dnsRound = attribute({ probes: [icmp(true), dns(false)], env: envWith(), prev: local });
    expect(dnsRound.layer).toBe(LAYERS.DNS);
    expect(dnsRound.streak).toBe(1);
    expect(dnsRound.pending).toBe(true);
  });

  it("returns to healthy and clears pending once the fault clears", () => {
    const input = { probes: [icmp(false), tcp(false)], env: envWith() };
    const confirmed = attribute({ ...input, prev: attribute(input) });
    expect(confirmed.pending).toBe(false);

    const recovered = attribute({ probes: [icmp(true), dns(true)], env: envWith(), prev: confirmed });
    expect(recovered.layer).toBe(LAYERS.UNKNOWN);
    expect(recovered.streak).toBe(1);
  });

  it("never marks unknown as pending — absence of evidence is not a claim", () => {
    const verdict = attribute({ probes: [icmp(true), dns(true)], env: envWith() });
    expect(verdict.layer).toBe(LAYERS.UNKNOWN);
    expect(verdict.pending).toBe(false);
  });
});

describe("purity and robustness", () => {
  it("does not mutate its inputs", () => {
    const input = { probes: [icmp(false)], env: envWith(), prev: null };
    const snapshot = JSON.stringify(input);
    attribute(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("tolerates empty input", () => {
    const verdict = attribute({});
    expect(verdict.layer).toBe(LAYERS.UNKNOWN);
    expect(Array.isArray(verdict.reasons)).toBe(true);
  });

  it("tolerates a missing env", () => {
    const verdict = attribute({ probes: [icmp(false), tcp(false)] });
    expect(verdict.layer).toBe(LAYERS.LOCAL);
  });

  it("is deterministic for identical input", () => {
    const input = { probes: [icmp(true), dns(false)], env: envWith() };
    expect(JSON.stringify(attribute(input))).toBe(JSON.stringify(attribute(input)));
  });
});

describe("summarize", () => {
  it("labels a confirmed verdict", () => {
    expect(summarize({ layer: LAYERS.DNS, pending: false })).toBe("DNS");
  });

  it("marks a pending verdict", () => {
    expect(summarize({ layer: LAYERS.VPN, pending: true })).toBe("VPN（待确认）");
  });

  it("handles null", () => {
    expect(summarize(null)).toBe("");
  });
});
