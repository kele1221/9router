import { getAdapter } from "@/lib/db/driver.js";
import { parseJson, stringifyJson } from "@/lib/db/helpers/jsonCol.js";

const EVENT_SCOPE = "forkEvents";
const EVENT_KEY = "rateLimitNormalization";
const MAX_RECENT_EVENTS = 20;

function emptySummary() {
  return { totalCount: 0, lastEvent: null, recentEvents: [] };
}

function sanitizeEvent(event = {}) {
  const connectionId = typeof event.connectionId === "string" && event.connectionId
    ? `${event.connectionId.slice(0, 10)}...`
    : null;

  return {
    provider: String(event.provider || "unknown").slice(0, 160),
    model: String(event.model || "unknown").slice(0, 240),
    connectionId,
    originalStatus: 400,
    normalizedStatus: 429,
    occurredAt: event.occurredAt || new Date().toISOString(),
  };
}

export async function recordRateLimitNormalization(event) {
  const db = await getAdapter();
  const safeEvent = sanitizeEvent(event);
  let nextSummary;

  db.transaction(() => {
    const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [EVENT_SCOPE, EVENT_KEY]);
    const current = row ? parseJson(row.value, emptySummary()) : emptySummary();
    const recentEvents = [...(current.recentEvents || []), safeEvent]
      .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
      .slice(0, MAX_RECENT_EVENTS);

    nextSummary = {
      totalCount: Number(current.totalCount || 0) + 1,
      lastEvent: recentEvents[0] || safeEvent,
      recentEvents,
    };

    db.run(
      "INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value",
      [EVENT_SCOPE, EVENT_KEY, stringifyJson(nextSummary)],
    );
  });

  return nextSummary;
}

export async function getRateLimitNormalizationSummary() {
  const db = await getAdapter();
  const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [EVENT_SCOPE, EVENT_KEY]);
  if (!row) return emptySummary();

  const stored = parseJson(row.value, emptySummary());
  return {
    totalCount: Number(stored.totalCount || 0),
    lastEvent: stored.lastEvent || null,
    recentEvents: Array.isArray(stored.recentEvents) ? stored.recentEvents : [],
  };
}
