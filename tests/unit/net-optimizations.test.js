import { describe, it, expect, beforeEach } from "vitest";

import { pivotSeries } from "../../src/app/(dashboard)/dashboard/network/constants.js";
import { pickProbeTargets, probeUpstream } from "../../src/lib/netMonitor/probes/upstream.js";
import { envCutoff, rawCutoff, hourlyCutoffBucket, runRetention } from "../../src/lib/netMonitor/retention.js";
import { pruneEnv, insertSamples, getRawHistory } from "../../src/lib/db/index.js";
import { getAdapter } from "../../src/lib/db/driver.js";
import { resolveNetMonitorConfig, NET_MONITOR_DEFAULTS } from "../../src/lib/netMonitor/config.js";
import { GET as getHistory } from "../../src/app/api/net-monitor/history/route.js";

beforeEach(async () => {
  const db = await getAdapter();
  db.run(`DELETE FROM netMonitorSamples`);
  db.run(`DELETE FROM netMonitorHourly`);
});

const row = (over = {}) => ({
  ts: "2026-10-17T10:00:00.000Z", target: "1.1.1.1", kind: "icmp",
  ok: true, rttAvgMs: 40, rttMinMs: 39, rttMaxMs: 41, jitterMs: 1, lossPct: 0, error: null,
  ...over,
});

describe("pivotSeries — one line per target", () => {
  // The bug this guards: four targets at the same timestamp used to become one
  // series of [40, 400, 5, 12], which recharts drew as violent fake jitter.
  it("keeps each target in its own column instead of one mixed series", () => {
    const ts = "2026-10-17T10:00:00.000Z";
    const { points, targets } = pivotSeries([
      row({ ts, target: "1.1.1.1", kind: "icmp", rttAvgMs: 40 }),
      row({ ts, target: "8.8.8.8", kind: "icmp", rttAvgMs: 400 }),
      row({ ts, target: "1.1.1.1:443", kind: "tcp", rttAvgMs: 5 }),
      row({ ts, target: "github.com", kind: "dns", rttAvgMs: 12 }),
    ], "rttAvgMs");

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      "icmp:1.1.1.1": 40,
      "icmp:8.8.8.8": 400,
      "tcp:1.1.1.1:443": 5,
      "dns:github.com": 12,
    });
    expect(targets).toHaveLength(4);
  });

  it("merges the same targets across timestamps into sorted points", () => {
    const { points } = pivotSeries([
      row({ ts: "2026-10-17T10:01:00.000Z", rttAvgMs: 42 }),
      row({ ts: "2026-10-17T10:00:00.000Z", rttAvgMs: 40 }),
    ], "rttAvgMs");
    expect(points.map((p) => p.ts)).toEqual([
      "2026-10-17T10:00:00.000Z",
      "2026-10-17T10:01:00.000Z",
    ]);
    expect(points[0]["icmp:1.1.1.1"]).toBe(40);
    expect(points[1]["icmp:1.1.1.1"]).toBe(42);
  });

  it("drops env change events and null values", () => {
    const { points, targets } = pivotSeries([
      row(),
      row({ kind: "env", target: "env", rttAvgMs: null }),
      row({ target: "8.8.8.8", rttAvgMs: null }),
    ], "rttAvgMs");
    expect(targets).toEqual(["icmp:1.1.1.1"]);
    expect(points).toHaveLength(1);
  });

  it("keeps loss rows where TCP/DNS are null (ICMP-only metric)", () => {
    const ts = "2026-10-17T10:00:00.000Z";
    const { points, targets } = pivotSeries([
      row({ ts, kind: "icmp", target: "1.1.1.1", lossPct: 0 }),
      row({ ts, kind: "icmp", target: "8.8.8.8", lossPct: 33 }),
      row({ ts, kind: "tcp", target: "1.1.1.1:443", lossPct: null }),
    ], "lossPct");
    expect(targets).toEqual(["icmp:1.1.1.1", "icmp:8.8.8.8"]);
    expect(points[0]["icmp:8.8.8.8"]).toBe(33);
  });

  it("returns empty output for empty input", () => {
    expect(pivotSeries([], "rttAvgMs")).toEqual({ points: [], targets: [] });
    expect(pivotSeries(undefined, "rttAvgMs")).toEqual({ points: [], targets: [] });
  });

  it("lets the last value win for a duplicated (ts, target)", () => {
    const ts = "2026-10-17T10:00:00.000Z";
    const { points } = pivotSeries([
      row({ ts, rttAvgMs: 40 }), row({ ts, rttAvgMs: 99 }),
    ], "rttAvgMs");
    expect(points).toHaveLength(1);
    expect(points[0]["icmp:1.1.1.1"]).toBe(99);
  });
});

describe("upstream probe target selection", () => {
  it("picks one model per provider, skipping unknown providers", () => {
    const targets = pickProbeTargets([
      { provider: "openai", isActive: true },
      { provider: "openai", isActive: true },
      { provider: "unknown-provider", isActive: true },
      { provider: "anthropic", isActive: true },
    ]);
    expect(targets.map((t) => t.provider)).toEqual(["openai", "anthropic"]);
  });

  it("skips inactive connections", () => {
    const targets = pickProbeTargets([
      { provider: "openai", isActive: false },
      { provider: "anthropic", isActive: true },
    ]);
    expect(targets.map((t) => t.provider)).toEqual(["anthropic"]);
  });

  it("caps the number of providers probed", () => {
    const targets = pickProbeTargets([
      { provider: "openai" }, { provider: "anthropic" },
      { provider: "gemini" }, { provider: "deepseek" },
    ], { limit: 2 });
    expect(targets).toHaveLength(2);
  });

  it("returns nothing when there is no supported provider", () => {
    expect(pickProbeTargets([{ provider: "nope" }])).toEqual([]);
    expect(pickProbeTargets([])).toEqual([]);
    expect(pickProbeTargets(null)).toEqual([]);
  });

  it("yields no results for an empty target list without touching the network", async () => {
    expect(await probeUpstream([])).toEqual([]);
  });
});

describe("env retention", () => {
  it("bounds env rows that pruneRaw deliberately leaves alone", async () => {
    await insertSamples([
      row({ ts: "2026-01-01T00:00:00.000Z", kind: "icmp" }),
      row({ ts: "2026-01-01T00:01:00.000Z", kind: "env", target: "env", rttAvgMs: null, lossPct: null }),
      row({ ts: "2026-10-01T00:00:00.000Z", kind: "env", target: "env", rttAvgMs: null, lossPct: null }),
    ]);

    await pruneEnv("2026-06-01T00:00:00.000Z");
    const envRows = await getRawHistory({ target: "env" });
    expect(envRows).toHaveLength(1);
    expect(envRows[0].ts).toBe("2026-10-01T00:00:00.000Z");
  });

  it("computes the env cutoff from the retention window", () => {
    const now = new Date("2026-10-17T12:00:00.000Z");
    expect(envCutoff(now, 180)).toBe("2026-04-20T12:00:00.000Z");
  });

  it("prunes all three tiers in one pass", async () => {
    await insertSamples([
      row({ ts: "2020-01-01T00:00:00.000Z", kind: "icmp" }),
      row({ ts: "2020-01-01T00:00:00.000Z", kind: "env", target: "env", rttAvgMs: null, lossPct: null }),
    ]);
    await runRetention(new Date("2026-10-17T12:00:00.000Z"), {
      rawRetentionDays: 7, hourlyRetentionDays: 90, envRetentionDays: 180,
    });
    expect(await getRawHistory({ target: "env" })).toHaveLength(0);
    expect(await getRawHistory({ target: "1.1.1.1" })).toHaveLength(0);
  });

  it("keeps retention boundaries exact", () => {
    const now = new Date("2026-10-17T12:00:00.000Z");
    expect(rawCutoff(now, 7)).toBe("2026-10-10T12:00:00.000Z");
    expect(hourlyCutoffBucket(now, 90)).toBe("2026-07-19T12");
  });
});

describe("resolveNetMonitorConfig — new keys", () => {
  it("defaults probeUpstream to false and envRetentionDays to 180", () => {
    const config = resolveNetMonitorConfig({});
    expect(config.probeUpstream).toBe(false);
    expect(config.envRetentionDays).toBe(180);
  });

  it("keeps an explicit probeUpstream true", () => {
    expect(resolveNetMonitorConfig({ netMonitor: { probeUpstream: true } }).probeUpstream).toBe(true);
  });

  it("treats a non-boolean probeUpstream as false", () => {
    expect(resolveNetMonitorConfig({ netMonitor: { probeUpstream: "yes" } }).probeUpstream).toBe(false);
  });

  it("rejects a non-positive envRetentionDays", () => {
    expect(resolveNetMonitorConfig({ netMonitor: { envRetentionDays: 0 } }).envRetentionDays)
      .toBe(NET_MONITOR_DEFAULTS.envRetentionDays);
  });
});

describe("history downsampling", () => {
  const req = (url) => new Request(url);

  it("caps the point count for a 24h window", async () => {
    // 4 targets × 600 rounds spread over 24h — far more raw rows than the chart needs.
    const rows = [];
    for (let i = 0; i < 600; i += 1) {
      const ts = new Date(Date.now() - i * 144000).toISOString();
      for (const target of ["1.1.1.1", "8.8.8.8"]) {
        rows.push(row({ ts, target, rttAvgMs: 40 + (i % 10) }));
      }
    }
    await insertSamples(rows);

    const res = await getHistory(req("http://localhost/api/net-monitor/history?period=24h"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.points.length).toBeLessThanOrEqual(480 + 4);
    // Every point keeps its identity so the client can still pivot per target.
    for (const p of body.points) {
      expect(p.target).toBeTruthy();
      expect(p.kind).toBeTruthy();
    }
  });

  it("averages loss within a bucket rather than sampling one row", async () => {
    const base = Date.now() - 60000;
    await insertSamples([
      row({ ts: new Date(base).toISOString(), lossPct: 0 }),
      row({ ts: new Date(base + 1000).toISOString(), lossPct: 100 }),
    ]);
    const res = await getHistory(req("http://localhost/api/net-monitor/history?period=1h"));
    const [p] = (await res.json()).points;
    expect(p.lossPct).toBe(50);
    expect(p.samples).toBe(2);
  });

  it("returns an empty list rather than failing on no data", async () => {
    const res = await getHistory(req("http://localhost/api/net-monitor/history?period=7d"));
    expect(res.status).toBe(200);
    expect((await res.json()).points).toEqual([]);
  });
});

describe("constants module export surface", () => {
  // Caught in a real browser only: SERIES_COLORS was declared but never
  // exported, so the client imported `undefined` and threw while rendering.
  // The build happily compiled it; only a render failed.
  it("exports every symbol the client imports", async () => {
    const mod = await import("../../src/app/(dashboard)/dashboard/network/constants.js");
    for (const name of [
      "POLL_INTERVAL_MS", "PERIODS", "tooltipStyle", "axisTick", "pivotSeries",
      "SERIES_COLORS", "formatMs", "formatPercent", "formatTime", "formatAxisTime",
      "rttTone", "lossTone", "overallTone", "LAYER_LABELS", "CONFIDENCE_LABELS",
      "confidenceVariant", "summarizeLatest",
    ]) {
      expect(mod[name], `${name} must be exported`).toBeDefined();
    }
    expect(Array.isArray(mod.SERIES_COLORS)).toBe(true);
    expect(mod.SERIES_COLORS.length).toBeGreaterThan(0);
  });
});
