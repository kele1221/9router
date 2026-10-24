// Aggregates local network environment state for the monitor. Read-only: it
// queries existing providers and the OS, and never changes network state.
import { getDefaultRoute, getDnsServers, getTunnelInterfaces, getSystemVpn, getEgressIp } from "./probes/localEnv.js";

// Reads Tailscale straight from the CLI rather than getTailscaleStatus(): that
// helper reports `false` unless 9Router's own tailscaleEnabled setting is on, so
// it cannot answer "is this machine on a tailnet right now".
async function readTailscale() {
  try {
    const mod = await import("@/lib/tunnel/tailscale/tailscale.js");
    const bin = mod.getTailscaleBin?.();
    if (!bin) return null;

    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    // TAILSCALE_SOCKET keeps the CLI on the user socket, so no sudo is needed.
    const args = ["--socket", mod.TAILSCALE_SOCKET, "status", "--json"];
    const { stdout } = await execFileAsync(bin, args, { timeout: 4000, windowsHide: true, maxBuffer: 512 * 1024 });
    const parsed = JSON.parse(stdout);
    return {
      present: true,
      backendState: parsed.BackendState || null,
      online: parsed.BackendState === "Running",
      tailnet: parsed.CurrentTailnet?.Name || null,
      selfHost: parsed.Self?.HostName || null,
      selfIp: parsed.Self?.TailscaleIPs?.[0] || null,
      exitNode: Boolean(parsed.ExitNodeStatus?.ID),
      peerCount: parsed.Peer ? Object.keys(parsed.Peer).length : 0,
    };
  } catch {
    return null;
  }
}

// Clash / mihomo: read the selector group through the existing controller. The
// controller only exists when a clash pool is configured, so absence is normal
// and reported as null rather than as an error.
async function readClash() {
  try {
    const { getSettings, getProxyPools } = await import("@/lib/localDb");
    const settings = await getSettings();
    if (!settings?.proxyRotation?.enabled) return null;
    const pools = (await getProxyPools({ isActive: true })).filter((p) => p.type === "clash");
    if (!pools.length) return null;

    const { getClashController } = await import("@/lib/network/clashController.js");
    const controller = getClashController(pools[0]);
    const proxies = await controller.getProxies();
    if (!proxies?.proxies) return null;

    const groups = Object.values(proxies.proxies).filter((p) => Array.isArray(p.all));
    const selector = groups.find((g) => g.type === "Selector") || groups[0] || null;
    return {
      present: true,
      poolId: pools[0].id,
      poolName: pools[0].name || null,
      selected: selector?.now || null,
      groupType: selector?.type || null,
      nodeCount: selector?.all?.length || 0,
    };
  } catch {
    return null;
  }
}

function classifyVpn({ tailscale, clash, systemVpn, tunnels }) {
  // Authoritative sources first. Anything derived from interface presence alone
  // is marked suspected, because macOS creates utun for non-VPN reasons too.
  if (tailscale?.online) {
    return { connected: true, suspected: false, via: "tailscale" };
  }
  const connectedSystem = systemVpn.find((s) => s.connected);
  if (connectedSystem) {
    return { connected: true, suspected: false, via: "system", name: connectedSystem.name };
  }
  if (clash?.present) {
    return { connected: true, suspected: false, via: "clash", name: clash.selected };
  }
  if (tunnels.length) {
    return { connected: false, suspected: true, via: null, note: `${tunnels.length} tunnel interface(s) present but no VPN reports connected` };
  }
  return { connected: false, suspected: false, via: null };
}

// The egress IP rarely changes, but asking for it costs an HTTPS round trip to
// Cloudflare. At a 60s interval that would be 1440 requests a day for a value
// that changes maybe twice. Re-fetch only when the local route/interface moved
// (the only thing that can change it) or when the cached value has aged out.
const EGRESS_TTL_MS = 300000;

async function readEgress() {
  const now = Date.now();
  const cached = egressCache.value;
  const hasCache = cached !== null && cached !== undefined;
  const fresh = hasCache && (now - egressCache.at) < EGRESS_TTL_MS;
  if (fresh) return cached;

  const value = await getEgressIp();
  // Keep the last known value if the request failed — a null here would look
  // like "egress IP disappeared" and fire a spurious env change event.
  if (value) {
    egressCache.value = value;
    egressCache.at = now;
    return value;
  }
  return hasCache ? cached : null;
}

function invalidateEgress() {
  egressCache.value = null;
  egressCache.at = 0;
}

const egressCache = { value: null, at: 0, };

export function resetEgressCacheForTests() {
  invalidateEgress();
}

export async function collectLocalEnv() {
  const [route, dnsServers, systemVpn, egress, tailscale, clash] = await Promise.all([
    getDefaultRoute(),
    getDnsServers(),
    getSystemVpn(),
    readEgress(),
    readTailscale(),
    readClash(),
  ]);

  const tunnels = getTunnelInterfaces();
  const vpn = classifyVpn({ tailscale, clash, systemVpn, tunnels });

  return {
    route,
    dnsServers,
    tunnels,
    systemVpn,
    egress,
    tailscale,
    clash,
    vpn,
  };
}

// Compact, comparable shape. Change detection compares these strings, so it must
// stay stable and free of volatile fields (timings, counts that drift).
export function envFingerprint(env) {
  return JSON.stringify({
    gateway: env.route?.gateway ?? null,
    iface: env.route?.interface ?? null,
    dns: env.dnsServers,
    egressIp: env.egress?.ip ?? null,
    tunnels: env.tunnels.map((t) => t.name).sort(),
    vpnConnected: env.vpn.connected,
    vpnVia: env.vpn.via,
    vpnName: env.vpn.name ?? null,
    systemVpn: env.systemVpn.map((s) => `${s.name}:${s.status}`).sort(),
    tailscale: env.tailscale?.backendState ?? null,
    clash: env.clash?.selected ?? null,
  });
}

export function diffEnv(prevFingerprint, nextFingerprint) {
  if (!prevFingerprint || prevFingerprint === nextFingerprint) return null;
  let prev = {};
  let next = {};
  try { prev = JSON.parse(prevFingerprint); } catch { /* first run */ }
  try { next = JSON.parse(nextFingerprint); } catch { return { changed: true, fields: [] }; }

  const fields = [];
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      fields.push({ field: key, from: prev[key] ?? null, to: next[key] ?? null });
    }
  }
  return fields.length ? { changed: true, fields } : null;
}
