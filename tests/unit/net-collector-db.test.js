import { describe, it, expect, beforeEach } from "vitest";

import { insertSamples, getRawHistory, getLatestSamples, getHourlyHistory, aggregateHour, pruneRaw, pruneHourly, countSamples } from "../../src/lib/db/index.js";
import { getAdapter } from "../../src/lib/db/driver.js";
import { collectOnce } from "../../src/lib/netMonitor/collector.js";
import { resolveNetMonitorConfig, NET_MONITOR_DEFAULTS } from "../../src/lib/netMonitor/config.js";
import { rawCutoff, hourBucket, hourlyCutoffBucket } from "../../src/lib/netMonitor/retention.js";

// DATA_DIR is per-file, not per-test: clear the two tables so cases that assert
// on totals don't inherit rows from earlier cases.
beforeEach(async () => {
  const db = await getAdapter();
  db.run(`DELETE FROM netMonitorSamples`);
  db.run(`DELETE FROM netMonitorHourly`);
});

const sample = (over = {}) => ({
  ts: "2026-10-17T10:00:00.000Z",
  target: "1.1.1.1",
  kind: "icmp",
  ok: true,
  rttAvgMs: 40,
  rttMinMs: 39,
  rttMaxMs: 41,
  jitterMs: 1,
  lossPct: 0,
  error: null,
  ...over,
});

describe("netMonitorRepo", () => {
  it("inserts a batch and reads it back with ok as a boolean", async () => {
    await insertSamples([sample(), sample({ target: "8.8.8.8", ok: false, rttAvgMs: null, lossPct: 100 })]);
    const rows = await getRawHistory({ target: "1.1.1.1" });
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(true);
    expect(rows[0].rttAvgMs).toBe(40);

    const failed = await getRawHistory({ target: "8.8.8.8" });
    expect(failed[0].ok).toBe(false);
    expect(failed[0].lossPct).toBe(100);
  });

  it("filters by time range", async () => {
    await insertSamples([
      sample({ ts: "2026-10-17T08:00:00.000Z" }),
      sample({ ts: "2026-10-17T12:00:00.000Z" }),
    ]);
    const rows = await getRawHistory({ from: "2026-10-17T10:00:00.000Z" });
    expect(rows).toHaveLength(1);
    expect(rows[0].ts).toBe("2026-10-17T12:00:00.000Z");
  });

  it("returns the newest rows first from getLatestSamples", async () => {
    await insertSamples([
      sample({ ts: "2026-10-17T10:00:00.000Z" }),
      sample({ ts: "2026-10-17T11:00:00.000Z" }),
    ]);
    const rows = await getLatestSamples(10);
    expect(rows).toHaveLength(2);
    expect(rows[0].ts).toBe("2026-10-17T11:00:00.000Z");
  });

  it("aggregates an hour with avg / p95 / loss", async () => {
    await insertSamples([
      sample({ ts: "2026-10-17T09:15:00.000Z", rttAvgMs: 10, jitterMs: 1, lossPct: 0 }),
      sample({ ts: "2026-10-17T09:30:00.000Z", rttAvgMs: 20, jitterMs: 3, lossPct: 0 }),
      sample({ ts: "2026-10-17T09:45:00.000Z", rttAvgMs: 60, jitterMs: 5, lossPct: 50 }),
      sample({ ts: "2026-10-17T09:50:00.000Z", rttAvgMs: 100, jitterMs: 7, lossPct: 0, ok: false }),
    ]);
    await aggregateHour("2026-10-17T09");

    const [row] = await getHourlyHistory({ target: "1.1.1.1", from: "2026-10-17T09" });
    expect(row.samples).toBe(4);
    expect(row.okCount).toBe(3);
    expect(row.rttAvgMs).toBe(48);
    expect(row.rttP95Ms).toBe(100);
    expect(row.jitterAvgMs).toBe(4);
    expect(row.lossAvgPct).toBe(12.5);
  });

  it("is idempotent when the same hour is aggregated twice", async () => {
    await insertSamples([sample({ ts: "2026-10-17T09:15:00.000Z", rttAvgMs: 30 })]);
    await aggregateHour("2026-10-17T09");
    await aggregateHour("2026-10-17T09");
    const rows = await getHourlyHistory({ target: "1.1.1.1", from: "2026-10-17T09" });
    expect(rows).toHaveLength(1);
    expect(rows[0].rttAvgMs).toBe(30);
  });

  it("excludes env change events from aggregation", async () => {
    await insertSamples([sample({ ts: "2026-10-17T07:30:00.000Z", kind: "env", target: "env", rttAvgMs: null, lossPct: null })]);
    expect(await aggregateHour("2026-10-17T07")).toBe(0);
  });

  it("prunes raw samples but keeps env change events", async () => {
    await insertSamples([
      sample({ ts: "2026-01-01T00:00:00.000Z" }),
      sample({ ts: "2026-01-01T00:01:00.000Z", kind: "env", target: "env", rttAvgMs: null, lossPct: null }),
    ]);
    await pruneRaw("2026-06-01T00:00:00.000Z");

    expect(await getRawHistory({ target: "1.1.1.1", from: "2026-01-01" })).toHaveLength(0);
    const envRows = await getRawHistory({ target: "env" });
    expect(envRows).toHaveLength(1);
    expect(envRows[0].kind).toBe("env");
  });

  it("prunes hourly buckets older than the cutoff", async () => {
    await insertSamples([sample({ ts: "2026-01-01T05:10:00.000Z" })]);
    await aggregateHour("2026-01-01T05");
    expect(await getHourlyHistory({})).toHaveLength(1);

    await pruneHourly("2026-06-01T00");
    expect(await getHourlyHistory({})).toHaveLength(0);
  });
});

describe("collector", () => {
  it("shapes every target into a sample row", async () => {
    const rows = await collectOnce({
      targets: { icmp: ["127.0.0.1"], tcp: [{ host: "127.0.0.1", port: 9 }], dns: ["localhost"] },
      ts: "2026-10-17T10:00:00.000Z",
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.kind).sort()).toEqual(["dns", "icmp", "tcp"]);
    for (const row of rows) {
      expect(row.ts).toBe("2026-10-17T10:00:00.000Z");
      expect(typeof row.ok).toBe("boolean");
    }
  });

  it("labels each tcp target with host:port", async () => {
    const rows = await collectOnce({
      targets: { icmp: [], tcp: [{ host: "127.0.0.1", port: 9 }], dns: [] },
    });
    expect(rows[0].target).toBe("127.0.0.1:9");
  });
});

describe("resolveNetMonitorConfig", () => {
  it("falls back to defaults when settings carry no netMonitor block", () => {
    expect(resolveNetMonitorConfig({})).toEqual(NET_MONITOR_DEFAULTS);
  });

  it("backfills nested keys a shallow settings merge would drop", () => {
    const config = resolveNetMonitorConfig({ netMonitor: { enabled: true } });
    expect(config.enabled).toBe(true);
    expect(config.targets).toEqual(NET_MONITOR_DEFAULTS.targets);
    expect(config.intervalMs).toBe(NET_MONITOR_DEFAULTS.intervalMs);
  });

  it("keeps explicit values and rejects non-positive numbers", () => {
    const config = resolveNetMonitorConfig({
      netMonitor: { enabled: true, intervalMs: 0, rawRetentionDays: 3, targets: { icmp: ["10.0.0.1"] } },
    });
    expect(config.intervalMs).toBe(NET_MONITOR_DEFAULTS.intervalMs);
    expect(config.rawRetentionDays).toBe(3);
    expect(config.targets.icmp).toEqual(["10.0.0.1"]);
    expect(config.targets.dns).toEqual(NET_MONITOR_DEFAULTS.targets.dns);
  });

  it("treats a non-boolean enabled as false", () => {
    expect(resolveNetMonitorConfig({ netMonitor: { enabled: "yes" } }).enabled).toBe(false);
  });
});

describe("retention boundaries", () => {
  const now = new Date("2026-10-17T12:00:00.000Z");

  it("puts the raw cutoff exactly 7 days back", () => {
    expect(rawCutoff(now, 7)).toBe("2026-10-10T12:00:00.000Z");
  });

  it("uses the ISO hour prefix as the bucket key", () => {
    expect(hourBucket(new Date("2026-10-17T09:41:22.000Z"))).toBe("2026-10-17T09");
  });

  it("puts the hourly cutoff bucket 90 days back", () => {
    expect(hourlyCutoffBucket(now, 90)).toBe("2026-07-19T12");
  });
});
