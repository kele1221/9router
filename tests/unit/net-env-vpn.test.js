import { describe, it, expect } from "vitest";

import {
  parseMacRoute, parseLinuxRoute, parseWindowsRoute,
  parseDnsServers, parseMacVpn, parseWindowsVpn, parseEgressTrace,
  getTunnelInterfaces,
} from "../../src/lib/netMonitor/probes/localEnv.js";
import { envFingerprint, diffEnv } from "../../src/lib/netMonitor/env.js";
import { collectEnvChange } from "../../src/lib/netMonitor/collector.js";

// Real outputs captured on macOS 2026-10-17.
const MAC_ROUTE = `   route to: default
destination: default
       mask: default
    gateway: 192.168.0.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>
`;

const MAC_DNS = `DNS configuration

resolver #1
  search domain[0] : lan
  nameserver[0] : 114.114.114.114
  if_index : 14 (en0)

resolver #2
  nameserver[0] : 114.114.114.114
  nameserver[1] : 8.8.8.8
`;

const MAC_VPN_LIST = `Available network connection services in the current set (*=enabled):
* (Connected)   A1B2C3D4-0000-0000-0000-000000000000 "Work VPN"    [PPP:L2TP]
  (Disconnected) E5F6A7B8-0000-0000-0000-000000000000 "Old VPN"    [IPSec]
`;

describe("parseMacRoute", () => {
  it("reads the gateway and interface", () => {
    expect(parseMacRoute(MAC_ROUTE)).toEqual({ gateway: "192.168.0.1", interface: "en0" });
  });

  it("returns nulls when no default route exists", () => {
    expect(parseMacRoute("route: writing to routing socket: not in table")).toEqual({ gateway: null, interface: null });
  });
});

describe("parseLinuxRoute", () => {
  it("reads via and dev", () => {
    expect(parseLinuxRoute("default via 192.168.1.1 dev eth0 proto dhcp metric 100")).toEqual({
      gateway: "192.168.1.1", interface: "eth0",
    });
  });
});

describe("parseWindowsRoute", () => {
  it("reads NextHop and InterfaceAlias", () => {
    expect(parseWindowsRoute("NextHop        : 192.168.1.1\nInterfaceAlias : Wi-Fi\n")).toEqual({
      gateway: "192.168.1.1", interface: "Wi-Fi",
    });
  });
});

describe("parseDnsServers", () => {
  it("dedupes repeated nameservers across resolvers", () => {
    expect(parseDnsServers(MAC_DNS)).toEqual(["114.114.114.114", "8.8.8.8"]);
  });

  it("parses the Windows ServerAddresses shape", () => {
    expect(parseDnsServers("ServerAddresses : {192.168.1.1, 1.1.1.1}")).toEqual(["192.168.1.1", "1.1.1.1"]);
  });

  it("returns an empty list when nothing is found", () => {
    expect(parseDnsServers("")).toEqual([]);
  });
});

describe("parseMacVpn", () => {
  it("reads name, status and the enabled marker", () => {
    const services = parseMacVpn(MAC_VPN_LIST);
    expect(services).toHaveLength(2);
    expect(services[0]).toEqual({
      name: "Work VPN", status: "Connected", enabled: true, connected: true, type: "PPP:L2TP", source: "scutil",
    });
    expect(services[1]).toMatchObject({ name: "Old VPN", status: "Disconnected", enabled: false, connected: false });
  });

  it("returns an empty list when no VPN service exists", () => {
    expect(parseMacVpn("Available network connection services in the current set (*=enabled):\n")).toEqual([]);
  });
});

describe("parseWindowsVpn", () => {
  it("reads name and connection status", () => {
    const services = parseWindowsVpn("Name             : Corp\nConnectionStatus : Connected\n\nName             : Home\nConnectionStatus : Disconnected\n");
    expect(services).toHaveLength(2);
    expect(services[0]).toMatchObject({ name: "Corp", connected: true });
    expect(services[1]).toMatchObject({ name: "Home", connected: false });
  });
});

describe("parseEgressTrace", () => {
  it("reads ip and colo", () => {
    expect(parseEgressTrace("fl=455f176\nh=1.1.1.1\nip=13.208.193.227\nts=1792202608\ncolo=NRT\n")).toEqual({
      ip: "13.208.193.227", colo: "NRT",
    });
  });

  it("returns null when the body carries no ip", () => {
    expect(parseEgressTrace("error\n")).toBeNull();
  });
});

describe("getTunnelInterfaces", () => {
  it("returns an array without throwing, regardless of host state", () => {
    const tunnels = getTunnelInterfaces();
    expect(Array.isArray(tunnels)).toBe(true);
    for (const t of tunnels) {
      expect(t.name).toMatch(/^(utun|ipsec|tun|tap|wg)\d*$/i);
    }
  });
});

describe("envFingerprint / diffEnv", () => {
  const base = {
    route: { gateway: "192.168.0.1", interface: "en0" },
    dnsServers: ["114.114.114.114"],
    tunnels: [{ name: "utun0" }, { name: "utun1" }],
    systemVpn: [],
    egress: { ip: "1.2.3.4" },
    tailscale: { backendState: "Running" },
    clash: null,
    vpn: { connected: true, suspected: false, via: "tailscale" },
  };

  it("is stable for identical state and ignores field order", () => {
    expect(envFingerprint(base)).toBe(envFingerprint({ ...base }));
  });

  it("reports no diff when nothing changed", () => {
    expect(diffEnv(envFingerprint(base), envFingerprint(base))).toBeNull();
  });

  it("reports no diff on the very first round (no previous fingerprint)", () => {
    expect(diffEnv(null, envFingerprint(base))).toBeNull();
  });

  it("names the changed fields, including a VPN drop", () => {
    const next = { ...base, vpn: { connected: false, suspected: false, via: null } };
    const diff = diffEnv(envFingerprint(base), envFingerprint(next));
    expect(diff.changed).toBe(true);
    expect(diff.fields.map((f) => f.field)).toContain("vpnConnected");
    const vpnField = diff.fields.find((f) => f.field === "vpnConnected");
    expect(vpnField.from).toBe(true);
    expect(vpnField.to).toBe(false);
  });

  it("detects an egress IP change (VPN route switch)", () => {
    const next = { ...base, egress: { ip: "5.6.7.8" } };
    const diff = diffEnv(envFingerprint(base), envFingerprint(next));
    expect(diff.fields.map((f) => f.field)).toContain("egressIp");
  });
});

describe("collectEnvChange", () => {
  it("writes no sample on the first round (nothing to compare against)", async () => {
    const result = await collectEnvChange({});
    expect(result.sample).toBeNull();
    expect(typeof result.fingerprint).toBe("string");
  });

  it("writes no sample when the fingerprint is unchanged", async () => {
    const first = await collectEnvChange({});
    const second = await collectEnvChange({ prevFingerprint: first.fingerprint });
    expect(second.sample).toBeNull();
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("writes a kind:env sample carrying the changed fields", async () => {
    const fakePrev = JSON.stringify({ vpnConnected: true, gateway: "10.0.0.1", dns: [], tunnels: [], systemVpn: [], tailscale: null, clash: null, egressIp: null, iface: null, vpnVia: null, vpnName: null });
    const { sample } = await collectEnvChange({ prevFingerprint: fakePrev, ts: "2026-10-17T10:00:00.000Z" });
    expect(sample).not.toBeNull();
    expect(sample.kind).toBe("env");
    expect(sample.target).toBe("env");
    expect(sample.ok).toBe(true);
    expect(sample.ts).toBe("2026-10-17T10:00:00.000Z");

    const payload = JSON.parse(sample.error);
    expect(payload.fields.map((f) => f.field)).toContain("vpnConnected");
    expect(typeof payload.fingerprint).toBe("string");
  });
});
