import { getAdapter } from "@/lib/db/driver.js";
import { parseJson } from "@/lib/db/helpers/jsonCol.js";
import { getApiKeys } from "@/lib/db/repos/apiKeysRepo.js";
import { buildUsageAnalytics, getUsagePeriodStart } from "@/lib/fork/usageAnalytics.js";

function queryForPeriod(table, columns, period, now) {
  const start = getUsagePeriodStart(period, now);
  if (!start) return { sql: `SELECT ${columns} FROM ${table} ORDER BY timestamp ASC`, params: [] };
  return {
    sql: `SELECT ${columns} FROM ${table} WHERE timestamp >= ? ORDER BY timestamp ASC`,
    params: [start.toISOString()],
  };
}

export async function getForkUsageDashboard(period = "24h") {
  const db = await getAdapter();
  const now = new Date();
  const usageQuery = queryForPeriod(
    "usageHistory",
    "timestamp, model, apiKey, promptTokens, completionTokens, status, tokens",
    period,
    now,
  );
  const detailQuery = queryForPeriod(
    "requestDetails",
    "timestamp, model, status, data",
    period,
    now,
  );

  const usageRows = db.all(usageQuery.sql, usageQuery.params).map((row) => ({
    ...row,
    tokens: parseJson(row.tokens, {}),
  }));
  const detailRows = db.all(detailQuery.sql, detailQuery.params).map((row) => {
    const data = parseJson(row.data, {});
    return {
      timestamp: row.timestamp,
      model: row.model,
      status: row.status,
      latency: data.latency || {},
    };
  });

  const apiKeyNames = {};
  try {
    const keys = await getApiKeys();
    for (const key of keys) {
      if (key?.key) apiKeyNames[key.key] = key.name || "未命名 API Key";
    }
  } catch {}

  return {
    period,
    generatedAt: now.toISOString(),
    ...buildUsageAnalytics({ usageRows, detailRows, apiKeyNames }, { period, now, limit: 5 }),
  };
}
