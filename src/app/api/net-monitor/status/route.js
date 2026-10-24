import { NextResponse } from "next/server";
import { getLatestSamples } from "@/lib/db/index.js";
import { getSchedulerState } from "@/lib/netMonitor/scheduler.js";
import { detectBackend } from "@/lib/netMonitor/probes/icmp.js";
import { summarize } from "@/lib/netMonitor/attribution.js";

export const dynamic = "force-dynamic";

// Coalesces rapid dashboard polls. The scheduler already refreshes state once a
// minute; this only prevents a burst of requests from each doing their own work.
const STATUS_CACHE_TTL_MS = 3000;
const statusCache = (global.__netMonitorStatusCache ??= { value: null, fetchedAt: 0 });

export async function GET() {
  try {
    let payload = statusCache.value;
    if (!payload || Date.now() - statusCache.fetchedAt >= STATUS_CACHE_TTL_MS) {
      payload = await buildStatus();
      statusCache.value = payload;
      statusCache.fetchedAt = Date.now();
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[NET_MONITOR] status failed:", error);
    return NextResponse.json({ error: "Failed to read network monitor status" }, { status: 500 });
  }
}

async function buildStatus() {
  const state = getSchedulerState();
  const samples = await getLatestSamples(100);

  // Latest value per target/kind — the cards show "right now", not a history.
  const latest = {};
  for (const sample of samples) {
    const key = `${sample.kind}:${sample.target}`;
    if (!latest[key]) latest[key] = sample;
  }

  const backend = await detectBackend().catch(() => "tcp");
  const env = state.env;

  return {
    collector: {
      running: state.running,
      ticks: state.ticks,
      lastTickAt: state.lastTickAt,
      lastError: state.lastError,
      backend,
      degraded: backend !== "fping",
    },
    latest,
    env: env
      ? {
        gateway: env.route?.gateway ?? null,
        interface: env.route?.interface ?? null,
        dnsServers: env.dnsServers ?? [],
        egress: env.egress ?? null,
        tunnels: env.tunnels ?? [],
        systemVpn: env.systemVpn ?? [],
        tailscale: env.tailscale ?? null,
        clash: env.clash ?? null,
        vpn: env.vpn ?? null,
      }
      : null,
    attribution: state.verdict
      ? { ...state.verdict, summary: summarize(state.verdict) }
      : null,
  };
}
