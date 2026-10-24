import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import { IS_WIN, IS_MAC } from "./platform.js";

const execFileAsync = promisify(execFile);

// Every function here is read-only: queries only, no state is changed. Anything
// that would alter the network (link down, proxy off, DNS rewrite) is out of
// scope for this module by design.

const TIMEOUT_MS = 5000;

async function run(bin, args, timeoutMs = TIMEOUT_MS) {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    return (stdout || "") + (stderr || "");
  } catch (err) {
    return (err?.stdout || "") + (err?.stderr || "");
  }
}

export async function getDefaultRoute() {
  if (IS_WIN) return parseWindowsRoute(await run("powershell", ["-NoProfile", "-Command", "Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object -First 1 | Format-List NextHop,InterfaceAlias"]));
  if (IS_MAC) return parseMacRoute(await run("route", ["-n", "get", "default"]));
  return parseLinuxRoute(await run("ip", ["route", "show", "default"]));
}

// macOS `route -n get default`:
//   gateway: 192.168.0.1
//   interface: en0
export function parseMacRoute(out) {
  const gateway = /gateway:\s*(\S+)/.exec(out)?.[1] ?? null;
  const iface = /interface:\s*(\S+)/.exec(out)?.[1] ?? null;
  return { gateway, interface: iface };
}

// Linux `ip route show default`: "default via 192.168.1.1 dev eth0 ..."
export function parseLinuxRoute(out) {
  const gateway = /via\s+(\S+)/.exec(out)?.[1] ?? null;
  const iface = /dev\s+(\S+)/.exec(out)?.[1] ?? null;
  return { gateway, interface: iface };
}

export function parseWindowsRoute(out) {
  const gateway = /NextHop\s*:\s*(\S+)/.exec(out)?.[1] ?? null;
  const iface = /InterfaceAlias\s*:\s*(.+)/.exec(out)?.[1]?.trim() ?? null;
  return { gateway, interface: iface };
}

export async function getDnsServers() {
  const out = IS_WIN
    ? await run("powershell", ["-NoProfile", "-Command", "Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object {$_.ServerAddresses} | Format-List InterfaceAlias,ServerAddresses"])
    : IS_MAC
      ? await run("scutil", ["--dns"])
      : await run("resolvectl", ["status"]);
  return parseDnsServers(out);
}

export function parseDnsServers(out) {
  const found = [...out.matchAll(/nameserver\[\d+\]\s*:\s*(\S+)/g)].map((m) => m[1]);
  if (found.length) return [...new Set(found)];
  const win = [...out.matchAll(/ServerAddresses\s*:\s*\{?([^}\n]+)\}?/g)]
    .flatMap((m) => m[1].split(/[,\s]+/))
    .filter(Boolean);
  return [...new Set(win)];
}

// Tunnel interfaces are only a hint that *something* is tunnelling: macOS also
// creates utun for iCloud Private Relay, Handoff and AirPlay. Callers must not
// read presence alone as "a VPN is connected".
export function getTunnelInterfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (!/^(utun|ipsec|tun|tap|wg)\d*$/i.test(name)) continue;
    const ipv4 = (addrs || []).find((a) => a.family === "IPv4" && !a.internal);
    out.push({ name, address: ipv4?.address ?? null, internal: !ipv4 });
  }
  return out;
}

export async function getSystemVpn() {
  if (IS_WIN) return parseWindowsVpn(await run("powershell", ["-NoProfile", "-Command", "Get-VpnConnection | Format-List Name,ConnectionStatus"]));
  if (IS_MAC) return parseMacVpn(await run("scutil", ["--nc", "list"]));
  return [];
}

// macOS `scutil --nc list`:
//   Available network connection services in the current set (*=enabled):
//   * (Connected)   12345678-... "Work VPN"    [PPP:L2TP]
//   Note: `*` means ENABLED here — the opposite of `networksetup
//   -listallnetworkservices`, where `*` means disabled.
export function parseMacVpn(out) {
  const services = [];
  for (const line of out.split("\n")) {
    const match = /^(\*)?\s*\((\w+)\)\s+(\S+)\s+"([^"]*)"\s*(?:\[([^\]]*)\])?/.exec(line.trim());
    if (!match) continue;
    services.push({
      name: match[4],
      status: match[2],
      enabled: Boolean(match[1]),
      connected: match[2] === "Connected",
      type: match[5] || null,
      source: "scutil",
    });
  }
  return services;
}

export function parseWindowsVpn(out) {
  const services = [];
  const blocks = out.split(/\n\s*\n/);
  for (const block of blocks) {
    const name = /Name\s*:\s*(.+)/.exec(block)?.[1]?.trim();
    const status = /ConnectionStatus\s*:\s*(\S+)/.exec(block)?.[1];
    if (!name) continue;
    services.push({
      name,
      status: status || "Unknown",
      enabled: true,
      connected: status === "Connected",
      type: null,
      source: "Get-VpnConnection",
    });
  }
  return services;
}

// Cloudflare's trace endpoint returns a small key=value body including the
// egress IP. Read-only GET; failure yields null rather than throwing.
export async function getEgressIp(timeoutMs = 5000) {
  try {
    const res = await fetch("https://1.1.1.1/cdn-cgi/trace", { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = await res.text();
    return parseEgressTrace(body);
  } catch {
    return null;
  }
}

export function parseEgressTrace(body) {
  const ip = /^ip=(.+)$/m.exec(body)?.[1]?.trim();
  const colo = /^colo=(.+)$/m.exec(body)?.[1]?.trim();
  return ip ? { ip, colo: colo ?? null } : null;
}
