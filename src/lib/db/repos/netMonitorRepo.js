// Network quality monitor samples. Two tables: raw 60s samples (kept 7d) and
// hourly aggregates (kept 90d). All local-only, written by the collector.
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

const nowIso = () => new Date().toISOString();

function sampleFromRow(row) {
  return {
    id: row.id,
    ts: row.ts,
    target: row.target,
    kind: row.kind,
    ok: row.ok === 1,
    rttAvgMs: row.rttAvgMs,
    rttMinMs: row.rttMinMs,
    rttMaxMs: row.rttMaxMs,
    jitterMs: row.jitterMs,
    lossPct: row.lossPct,
    error: row.error,
    createdAt: row.createdAt,
  };
}

function hourlyFromRow(row) {
  return {
    bucket: row.bucket,
    target: row.target,
    kind: row.kind,
    samples: row.samples,
    okCount: row.okCount,
    rttAvgMs: row.rttAvgMs,
    rttP95Ms: row.rttP95Ms,
    jitterAvgMs: row.jitterAvgMs,
    lossAvgPct: row.lossAvgPct,
  };
}

// Batched insert: one transaction for a whole collection round.
export async function insertSamples(samples) {
  if (!samples?.length) return 0;
  const db = await getAdapter();
  const ts = nowIso();
  db.transaction(() => {
    for (const s of samples) {
      db.run(
        `INSERT INTO netMonitorSamples(id, ts, target, kind, ok, rttAvgMs, rttMinMs, rttMaxMs, jitterMs, lossPct, error, createdAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(), s.ts, s.target, s.kind, s.ok ? 1 : 0,
          s.rttAvgMs ?? null, s.rttMinMs ?? null, s.rttMaxMs ?? null,
          s.jitterMs ?? null, s.lossPct ?? null, s.error ?? null, ts,
        ],
      );
    }
  });
  return samples.length;
}

export async function getRawHistory({ target, from, to, limit = 5000 } = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (target) { where.push("target = ?"); params.push(target); }
  if (from) { where.push("ts >= ?"); params.push(from); }
  if (to) { where.push("ts <= ?"); params.push(to); }
  const cap = Math.min(Math.max(Number(limit) || 5000, 1), 20000);
  const sql = `SELECT * FROM netMonitorSamples${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ts ASC LIMIT ?`;
  return db.all(sql, [...params, cap]).map(sampleFromRow);
}

export async function getLatestSamples(limit = 50) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM netMonitorSamples ORDER BY ts DESC LIMIT ?`, [limit]).map(sampleFromRow);
}

export async function getHourlyHistory({ target, from, limit = 5000 } = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (target) { where.push("target = ?"); params.push(target); }
  if (from) { where.push("bucket >= ?"); params.push(from); }
  const cap = Math.min(Math.max(Number(limit) || 5000, 1), 20000);
  const sql = `SELECT * FROM netMonitorHourly${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY bucket ASC LIMIT ?`;
  return db.all(sql, [...params, cap]).map(hourlyFromRow);
}

// Aggregate one hour bucket from raw samples and upsert it. Idempotent, so a
// re-run after a restart or a partial hour yields the same row.
export async function aggregateHour(bucket) {
  const db = await getAdapter();
  const start = `${bucket}:00:00.000Z`;
  const end = `${bucket}:59:59.999Z`;
  const rows = db.all(
    `SELECT target, kind, ok, rttAvgMs, jitterMs, lossPct
       FROM netMonitorSamples
      WHERE ts >= ? AND ts <= ? AND kind != 'env'`,
    [start, end],
  );
  if (!rows.length) return 0;

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.target}\u0000${row.kind}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const ts = nowIso();
  db.transaction(() => {
    for (const [key, group] of groups) {
      const [target, kind] = key.split("\u0000");
      const rtts = group.map((r) => r.rttAvgMs).filter((v) => v != null).sort((a, b) => a - b);
      const jitters = group.map((r) => r.jitterMs).filter((v) => v != null);
      const losses = group.map((r) => r.lossPct).filter((v) => v != null);
      const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
      const p95 = rtts.length ? rtts[Math.min(rtts.length - 1, Math.ceil(rtts.length * 0.95) - 1)] : null;
      db.run(
        `INSERT INTO netMonitorHourly(id, bucket, target, kind, samples, okCount, rttAvgMs, rttP95Ms, jitterAvgMs, lossAvgPct, createdAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bucket, target, kind) DO UPDATE SET
           samples = excluded.samples, okCount = excluded.okCount, rttAvgMs = excluded.rttAvgMs,
           rttP95Ms = excluded.rttP95Ms, jitterAvgMs = excluded.jitterAvgMs, lossAvgPct = excluded.lossAvgPct`,
        [
          uuidv4(), bucket, target, kind, group.length,
          group.filter((r) => r.ok === 1).length,
          avg(rtts), p95, avg(jitters),
          losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null,
          ts,
        ],
      );
    }
  });
  return groups.size;
}

export async function pruneRaw(beforeIso) {
  const db = await getAdapter();
  db.run(`DELETE FROM netMonitorSamples WHERE ts < ? AND kind != 'env'`, [beforeIso]);
}

// env rows are change events, not samples. They are tiny and individually
// valuable ("when did the VPN drop"), so they get a much longer window than raw
// samples — but they still need *a* bound, or a flaky network grows them
// forever.
export async function pruneEnv(beforeIso) {
  const db = await getAdapter();
  db.run(`DELETE FROM netMonitorSamples WHERE kind = 'env' AND ts < ?`, [beforeIso]);
}

export async function pruneHourly(beforeBucket) {
  const db = await getAdapter();
  db.run(`DELETE FROM netMonitorHourly WHERE bucket < ?`, [beforeBucket]);
}

export async function countSamples() {
  const db = await getAdapter();
  const raw = db.get(`SELECT COUNT(*) AS c FROM netMonitorSamples`);
  const hourly = db.get(`SELECT COUNT(*) AS c FROM netMonitorHourly`);
  return { raw: raw?.c || 0, hourly: hourly?.c || 0 };
}
