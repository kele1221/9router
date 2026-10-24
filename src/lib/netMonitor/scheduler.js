// In-process collector tick. Started from instrumentation.js so an API-only
// worker (no dashboard render) still collects, same as the modelEval scheduler.
// Single-process assumption: one router process owns the collection.
import { getSettings } from "@/lib/db/index.js";
import { insertSamples, aggregateHour } from "@/lib/db/index.js";
import { resolveNetMonitorConfig } from "./config.js";
import { collectOnce, collectEnvChange } from "./collector.js";
import { collectUpstream } from "./probes/upstream.js";
import { attribute } from "./attribution.js";
import { hourBucket, runRetention } from "./retention.js";

const RETRY_DELAY_MS = 15000;

// Aggregation and retention are driven by wall-clock elapsed time, not by a
// tick counter. A counter resets on every process restart (so a router
// restarted before the 60th tick would never aggregate or prune — the DB grows
// without bound), and it scales wrongly with a user-set interval (600s interval
// × 60 ticks = 10 hours between prunes).
const MAINTENANCE_INTERVAL_MS = 3600000;

// Upstream probes cost a real request per provider, so they run far less often
// than the local probes: roughly every 10 minutes at the default 60s interval.
const UPSTREAM_MIN_INTERVAL_MS = 600000;

const g = (global.__netMonitorScheduler ??= {
  timer: null, ticks: 0, lastTickAt: null, lastError: null, running: false, collecting: false,
  envFingerprint: null, lastEnv: null, lastVerdict: null,
  lastMaintenanceAt: 0, lastUpstreamAt: 0,
});

// `running` is the scheduler being alive, not the timer handle: tick() nulls the
// handle while it works, so deriving liveness from it made every in-flight round
// look stopped to a polling UI. `collecting` exposes the round itself.
export function getSchedulerState() {
  return {
    running: g.running,
    collecting: g.collecting,
    ticks: g.ticks,
    lastTickAt: g.lastTickAt,
    lastError: g.lastError,
    env: g.lastEnv || null,
    verdict: g.lastVerdict || null,
  };
}

// setTimeout self-scheduling (not setInterval): a slow round must not stack
// ticks, and a failed round retries sooner than the normal interval.
// Reads settings once up front so a disabled config arms nothing at all; a
// later disable is picked up by the running tick, which stops re-arming.
export async function startNetMonitorScheduler() {
  if (g.running) return;
  try {
    const config = resolveNetMonitorConfig(await getSettings());
    if (!config.enabled) return;
  } catch {
    return;
  }
  g.running = true;
  schedule(0);
}

export function stopNetMonitorScheduler() {
  if (g.timer) clearTimeout(g.timer);
  g.timer = null;
  g.running = false;
}

function schedule(delayMs) {
  g.timer = setTimeout(tick, delayMs);
  g.timer.unref?.();
}

async function tick() {
  g.timer = null;
  let nextDelay = null;

  try {
    const config = resolveNetMonitorConfig(await getSettings());
    if (!config.enabled) {
      // Disabled: stop entirely rather than idling. start() re-arms on restart
      // or when the settings route calls startNetMonitorScheduler again.
      g.running = false;
      return;
    }

    // Re-entrancy guard: a round that is still running must not be joined by
    // another (the self-scheduling timer makes overlaps unlikely, not impossible).
    if (!g.collecting) {
      g.collecting = true;
      try {
        const samples = await collectOnce({ targets: config.targets });

        // Env change detection rides along with the same tick. It must not sink
        // the probe round, so a failure here only skips the env sample.
        let envDiff = null;
        try {
          const { env, fingerprint, diff, sample } = await collectEnvChange({ prevFingerprint: g.envFingerprint });
          g.envFingerprint = fingerprint;
          g.lastEnv = env;
          envDiff = diff;
          if (sample) samples.push(sample);
        } catch (envErr) {
          console.warn("[NetMonitor] env probe failed:", envErr?.message);
        }

        // Upstream probes are slow and billed, so they ride on their own clock
        // and only when the local path is healthy — if the local link is down,
        // every provider would fail and blaming upstream would be wrong.
        if (config.probeUpstream !== false && Date.now() - g.lastUpstreamAt >= UPSTREAM_MIN_INTERVAL_MS) {
          const localHealthy = samples.some((s) => s.kind === "icmp" && s.ok)
            || samples.some((s) => s.kind === "tcp" && s.ok);
          if (localHealthy) {
            g.lastUpstreamAt = Date.now();
            try {
              samples.push(...await collectUpstream());
            } catch (upErr) {
              console.warn("[NetMonitor] upstream probe failed:", upErr?.message);
            }
          }
        }

        await insertSamples(samples);

        // Attribution is derived, not stored per round: it is cheap to recompute
        // and would otherwise need its own retention policy. The streak carried
        // in g.lastVerdict is what makes "two rounds to confirm" work.
        try {
          g.lastVerdict = attribute({ probes: samples, env: g.lastEnv, envDiff, prev: g.lastVerdict });
        } catch (attrErr) {
          console.warn("[NetMonitor] attribution failed:", attrErr?.message);
          // Clear rather than keep the previous verdict: a stale conclusion the
          // UI cannot distinguish from a fresh one is worse than no conclusion.
          g.lastVerdict = null;
        }

        g.ticks += 1;
        g.lastTickAt = new Date().toISOString();
        g.lastError = null;

        if (Date.now() - g.lastMaintenanceAt >= MAINTENANCE_INTERVAL_MS) {
          g.lastMaintenanceAt = Date.now();
          await aggregateHour(hourBucket(new Date(Date.now() - 3600000)));
          await runRetention(new Date(), config);
        }
      } finally {
        g.collecting = false;
      }
    }

    nextDelay = config.intervalMs;
  } catch (err) {
    g.lastError = err?.message || String(err);
    console.warn("[NetMonitor] collection failed:", g.lastError);
    nextDelay = RETRY_DELAY_MS;
  }

  if (nextDelay !== null) schedule(nextDelay);
}

export function resetSchedulerForTests() {
  stopNetMonitorScheduler();
  g.ticks = 0;
  g.lastTickAt = null;
  g.lastError = null;
  g.lastMaintenanceAt = 0;
  g.lastUpstreamAt = 0;
  g.running = false;
  g.collecting = false;
  g.envFingerprint = null;
  g.lastEnv = null;
  g.lastVerdict = null;
}
