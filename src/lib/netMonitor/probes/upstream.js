// Upstream link probe: can this router actually reach the providers it routes to?
//
// This is the layer the other probes cannot see. When local network, DNS and the
// proxy are all healthy but replies still fail, the fault is upstream — and
// without this probe the monitor would report "everything fine" through a
// provider outage.
//
// Cost note: unlike ICMP/TCP, this consumes a real request against a real
// account. It reuses the existing pingModelByKind() rather than inventing a
// second call path, and the scheduler runs it on its own much slower cadence
// (see UPSTREAM_EVERY_ROUNDS) so a 60s collection interval does not become 1440
// provider calls per day.
import { pingModelByKind } from "@/app/api/models/test/ping.js";

// One representative model per provider. Picked from the router's own alias
// table at call time; this map only needs to name a *kind* of model, and an
// unknown provider simply yields no upstream probe.
const PROBE_MODELS = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-2.0-flash",
  deepseek: "deepseek-chat",
  openrouter: "openai/gpt-4o-mini",
  groq: "llama-3.1-8b-instant",
  xai: "grok-3-mini",
};

// Cap concurrency: these hit the network and each one bills a token or two.
const MAX_PROVIDERS = 3;

export function pickProbeTargets(connections, { limit = MAX_PROVIDERS } = {}) {
  const seen = new Set();
  const targets = [];
  for (const conn of connections || []) {
    if (!conn?.provider || seen.has(conn.provider)) continue;
    if (conn.isActive === false) continue;
    const model = PROBE_MODELS[conn.provider];
    if (!model) continue;
    seen.add(conn.provider);
    targets.push({ provider: conn.provider, model });
    if (targets.length >= limit) break;
  }
  return targets;
}

export async function probeUpstream(targets, { timeoutMs = 20000 } = {}) {
  const results = [];
  for (const { provider, model } of targets) {
    const startedAt = Date.now();
    try {
      const res = await pingModelByKind(model, "llm");
      results.push({
        ts: new Date().toISOString(),
        target: provider,
        kind: "upstream",
        ok: res.ok === true,
        // pingModelByKind measures a full request, so this is total latency,
        // not TTFB — still the right signal for "is this link healthy".
        rttAvgMs: res.latencyMs ?? (Date.now() - startedAt),
        rttMinMs: null,
        rttMaxMs: null,
        jitterMs: null,
        lossPct: null,
        error: res.ok ? null : (res.error || `HTTP ${res.status ?? "?"}`),
      });
    } catch (err) {
      results.push({
        ts: new Date().toISOString(),
        target: provider,
        kind: "upstream",
        ok: false,
        rttAvgMs: null,
        rttMinMs: null,
        rttMaxMs: null,
        jitterMs: null,
        lossPct: null,
        error: err?.message || "upstream probe threw",
      });
    }
    // Sequential with a small gap: these are billed requests, and hammering
    // several providers at once is a good way to trip rate limits.
    if (results.length < targets.length) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  void timeoutMs;
  return results;
}

export async function collectUpstream({ limit = MAX_PROVIDERS } = {}) {
  try {
    const { getProviderConnections } = await import("@/lib/db/index.js");
    const connections = await getProviderConnections({ isActive: true });
    const targets = pickProbeTargets(connections, { limit });
    if (!targets.length) return [];
    return await probeUpstream(targets);
  } catch (err) {
    console.warn("[NetMonitor] upstream probe setup failed:", err?.message);
    return [];
  }
}
