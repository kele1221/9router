import { execProbe, icmpFlags } from "./platform.js";

// Upper bound for a whole round: count × (interval + timeout), plus slack.
const SLACK_MS = 2000;

let backendCache = null;

// ping needs no privileges on macOS (SOCK_DGRAM ICMP) and on Linux when the
// binary is setuid or net.ipv4.ping_group_range covers the user — both are the
// default on desktop distros. Containers often break that, hence the chain.
export async function detectBackend() {
  if (backendCache) return backendCache;
  if (await canRun("fping")) backendCache = "fping";
  else if (await canRun("ping")) backendCache = "ping";
  else backendCache = "tcp";
  return backendCache;
}

export function resetBackendCacheForTests() {
  backendCache = null;
}

async function canRun(bin) {
  // fping and ping share no flags: fping uses -p (interval, ms) and -t (timeout,
  // ms), ping uses -i (interval, s) and -W. Probing fping with ping's flags makes
  // it exit non-zero on "invalid option", which silently demotes us to ping.
  const args = bin === "fping"
    ? ["-q", "-c", "1", "-p", "300", "-t", "1000", "127.0.0.1"]
    : icmpFlags({ count: 1, intervalMs: 300, timeoutMs: 1000 }).concat("127.0.0.1");
  const out = await execProbe(bin, args, 3000);
  return out.includes("xmt/rcv") || out.includes("bytes from");
}

export async function probeIcmp(target, { count = 3, intervalMs = 300, timeoutMs = 1000 } = {}) {
  const backend = await detectBackend();
  if (backend === "fping") return probeWithFping(target, { count, intervalMs, timeoutMs });
  if (backend === "ping") return probeWithPing(target, { count, intervalMs, timeoutMs });
  return { ok: false, backend, error: "no ICMP backend available" };
}

const roundBudget = ({ count, intervalMs, timeoutMs }) => count * (intervalMs + timeoutMs) + SLACK_MS;

async function probeWithFping(target, opts) {
  const args = ["-q", "-c", String(opts.count), "-p", String(opts.intervalMs), "-t", String(opts.timeoutMs), target];
  const out = await execProbe("fping", args, roundBudget(opts));
  return parseFping(out);
}

// `fping -q -c N host` prints one line: host : xmt/rcv/%loss = 3/1/66%, min/avg/max = 64/64/64
export function parseFping(out) {
  const lossMatch = /xmt\/rcv\/%loss\s*=\s*(\d+)\/(\d+)\/([\d.]+)%/.exec(out);
  if (!lossMatch) return { ok: false, backend: "fping", error: "unparseable fping output" };
  const [, sent, received, lossPct] = lossMatch;
  const receivedCount = Number(received);
  if (receivedCount === 0) {
    return { ok: false, backend: "fping", lossPct: 100, rttAvgMs: null, rttMinMs: null, rttMaxMs: null, jitterMs: null };
  }
  const rttMatch = /min\/avg\/max\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/.exec(out);
  const min = rttMatch ? Number(rttMatch[1]) : null;
  const avg = rttMatch ? Number(rttMatch[2]) : null;
  const max = rttMatch ? Number(rttMatch[3]) : null;
  return {
    ok: Number(lossPct) < 100,
    backend: "fping",
    lossPct: Number(lossPct),
    rttAvgMs: avg,
    rttMinMs: min,
    rttMaxMs: max,
    jitterMs: min !== null && max !== null ? Math.round(max - min) : null,
  };
}

async function probeWithPing(target, opts) {
  const budget = roundBudget(opts);
  const out = await execProbe("ping", icmpFlags(opts).concat(target), budget);
  return parsePing(out);
}

// macOS sample:
//   PING 1.1.1.1 (1.1.1.1): 56 data bytes
//   64 bytes from 1.1.1.1: icmp_seq=0 ttl=50 time=39.309 ms
//   --- 1.1.1.1 ping statistics ---
//   2 packets transmitted, 2 packets received, 0.0% packet loss
//   round-trip min/avg/max/stddev = 39.309/39.454/39.599/0.145 ms
export function parsePing(out) {
  const lossMatch = /([\d.]+)% packet loss/.exec(out);
  if (!lossMatch) return { ok: false, backend: "ping", error: "unparseable ping output" };
  const lossPct = Number(lossMatch[1]);

  const statsMatch = /min\/avg\/max\/(?:stddev|mdev)\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/.exec(out);
  if (!statsMatch) {
    // 100% loss prints no round-trip line at all.
    return { ok: false, backend: "ping", lossPct, rttAvgMs: null, rttMinMs: null, rttMaxMs: null, jitterMs: null };
  }

  return {
    ok: lossPct < 100,
    backend: "ping",
    lossPct,
    rttAvgMs: Number(statsMatch[2]),
    rttMinMs: Number(statsMatch[1]),
    rttMaxMs: Number(statsMatch[3]),
    jitterMs: Math.round(Number(statsMatch[4])),
  };
}
