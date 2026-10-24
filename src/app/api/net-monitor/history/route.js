import { NextResponse } from "next/server";
import { getRawHistory, getHourlyHistory } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

const PERIODS = {
  "1h": { ms: 3600000, source: "raw", maxPoints: 240 },
  "24h": { ms: 86400000, source: "raw", maxPoints: 480 },
  "7d": { ms: 7 * 86400000, source: "raw", maxPoints: 672 },
  "90d": { ms: 90 * 86400000, source: "hourly", maxPoints: 2160 },
};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "24h";
    const target = searchParams.get("target") || null;

    if (!PERIODS[period]) {
      return NextResponse.json({ error: `Invalid period (expected ${Object.keys(PERIODS).join(", ")})` }, { status: 400 });
    }

    const { ms, source, maxPoints } = PERIODS[period];
    const from = new Date(Date.now() - ms).toISOString();
    const rows = source === "raw"
      ? await getRawHistory({ target, from })
      : await getHourlyHistory({ target, from });

    // Raw rows come back one per probe, so a 24h window is ~5760 rows across all
    // targets. Sending them all would put thousands of points into an SVG chart.
    // The cap is per target — the client draws one line per target, so each line
    // should carry at most maxPoints — hence the guard on how many targets we
    // actually have rather than assuming one.
    const targetCount = new Set(rows.map((r) => `${r.kind}:${r.target}`)).size || 1;
    const bucketMs = (ms / maxPoints) * targetCount;
    const points = bucket(rows, bucketMs);

    return NextResponse.json(
      { period, target, source, points },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[NET_MONITOR] history failed:", error);
    return NextResponse.json({ error: "Failed to load network history" }, { status: 500 });
  }
}

// Averages every row of the same (target, kind) that falls in the same time
// bucket. Loss is averaged too, which is what a trend chart wants — it shows
// sustained loss rather than a single dropped packet.
function bucket(rows, bucketMs) {
  if (!rows?.length) return [];
  const width = Math.max(Math.round(bucketMs), 1000);
  const groups = new Map();

  for (const row of rows) {
    const ts = row.ts || row.bucket;
    const time = Date.parse(ts);
    if (Number.isNaN(time)) continue;
    const key = `${row.kind}\u0000${row.target}\u0000${Math.floor(time / width)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        ts: new Date(Math.floor(time / width) * width).toISOString(),
        target: row.target,
        kind: row.kind,
        rttSum: 0, rttCount: 0,
        jitterSum: 0, jitterCount: 0,
        lossSum: 0, lossCount: 0,
        okCount: 0, total: 0,
      });
    }
    const g = groups.get(key);
    g.total += 1;
    if (row.ok) g.okCount += 1;
    if (row.rttAvgMs != null) { g.rttSum += row.rttAvgMs; g.rttCount += 1; }
    if (row.jitterMs != null) { g.jitterSum += row.jitterMs; g.jitterCount += 1; }
    if (row.lossPct != null) { g.lossSum += row.lossPct; g.lossCount += 1; }
  }

  const avg = (sum, count) => (count ? Math.round(sum / count) : null);
  return [...groups.values()]
    .map((g) => ({
      ts: g.ts,
      target: g.target,
      kind: g.kind,
      ok: g.okCount > 0,
      rttAvgMs: avg(g.rttSum, g.rttCount),
      jitterMs: avg(g.jitterSum, g.jitterCount),
      lossPct: g.lossCount ? Number((g.lossSum / g.lossCount).toFixed(1)) : null,
      samples: g.total,
    }))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}
