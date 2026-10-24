import { probeIcmp } from "./probes/icmp.js";
import { probeTcp } from "./probes/tcp.js";
import { probeDns } from "./probes/dns.js";
import { collectLocalEnv, envFingerprint, diffEnv } from "./env.js";

// Upstream probes bill a real request against a real account, so they run on a
// much slower cadence than the local probes — see UPSTREAM_EVERY_ROUNDS in
// scheduler.js. Including them here keeps "one round" a single concept.
export const UPSTREAM_KINDS = new Set(["upstream"]);

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

// One collection round. Never throws: every probe resolves to a result object,
// and a target that somehow rejects becomes a failed sample rather than aborting
// the round (fail-open, same contract as the RTK hooks).
export async function collectOnce({ targets, ts = new Date().toISOString(), concurrency = 4 } = {}) {
  const jobs = [];
  for (const host of targets.icmp) {
    jobs.push(() => probeIcmp(host).then((r) => shape(ts, host, "icmp", r)));
  }
  for (const entry of targets.tcp) {
    jobs.push(() => probeTcp(entry.host, entry.port).then((r) => shape(ts, `${entry.host}:${entry.port}`, "tcp", r)));
  }
  for (const hostname of targets.dns) {
    jobs.push(() => probeDns(hostname).then((r) => shape(ts, hostname, "dns", r)));
  }

  return mapLimit(jobs, concurrency, async (job) => {
    try {
      return await job();
    } catch (err) {
      return {
        ts, target: "unknown", kind: "error", ok: false,
        rttAvgMs: null, rttMinMs: null, rttMaxMs: null, jitterMs: null, lossPct: null,
        error: err?.message || "probe threw",
      };
    }
  });
}

// Environment state is not sampled every round — it changes rarely, and storing
// it per-tick would dwarf the probe data. Instead the fingerprint is compared
// against the previous round and only a *change* is written, as a kind:"env"
// sample whose error column carries the change description.
export async function collectEnvChange({ prevFingerprint, ts = new Date().toISOString() } = {}) {
  const env = await collectLocalEnv();
  const fingerprint = envFingerprint(env);
  const diff = diffEnv(prevFingerprint, fingerprint);
  return { env, fingerprint, diff, sample: diff ? envChangeSample(ts, diff, fingerprint) : null };
}

function envChangeSample(ts, diff, fingerprint) {
  return {
    ts,
    target: "env",
    kind: "env",
    ok: true,
    rttAvgMs: null,
    rttMinMs: null,
    rttMaxMs: null,
    jitterMs: null,
    lossPct: null,
    error: JSON.stringify({ fields: diff.fields, fingerprint }),
  };
}

function shape(ts, target, kind, result) {
  return {
    ts,
    target,
    kind,
    ok: result.ok === true,
    rttAvgMs: round(result.rttAvgMs ?? result.rttMs),
    rttMinMs: round(result.rttMinMs),
    rttMaxMs: round(result.rttMaxMs),
    jitterMs: round(result.jitterMs),
    lossPct: result.lossPct ?? null,
    error: result.ok ? null : (result.error || null),
  };
}

const round = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
