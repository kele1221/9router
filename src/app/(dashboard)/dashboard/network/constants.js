// Shared display helpers for the network monitor page, kept out of the
// component so they are testable without mounting React.
export const POLL_INTERVAL_MS = 10000;

export const PERIODS = [
  { value: "1h", label: "1 小时" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "90d", label: "90 天" },
];

export const tooltipStyle = {
  backgroundColor: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  color: "var(--color-text-main)",
  fontSize: 12,
};

export const axisTick = { fill: "var(--color-text-muted)", fontSize: 10 };

export function formatMs(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}

export function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(1)}%`;
}

export function formatTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatAxisTime(value, period) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  if (period === "1h" || period === "24h") {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

// Latency tone thresholds. Deliberately generous — on a home/office link, the
// interesting signal is "much worse than usual", not absolute milliseconds.
export function rttTone(ms) {
  if (ms == null) return "text-text-muted";
  if (ms < 100) return "text-success";
  if (ms < 300) return "text-warning";
  return "text-danger";
}

export function lossTone(pct) {
  if (pct == null) return "text-text-muted";
  if (pct <= 0) return "text-success";
  if (pct < 10) return "text-warning";
  return "text-danger";
}

// A probe round should be healthy overall when nothing is failing.
export function overallTone(health) {
  if (!health) return "text-text-muted";
  if (health.okCount === 0 && health.total > 0) return "text-danger";
  if (health.okCount < health.total) return "text-warning";
  return "text-success";
}

export const LAYER_LABELS = {
  local: "本机网络",
  dns: "DNS 解析",
  vpn: "VPN",
  proxy: "代理",
  upstream: "上游服务",
  unknown: "未发现异常",
};

export const CONFIDENCE_LABELS = {
  high: "高",
  medium: "中",
  low: "低",
};

export function confidenceVariant(confidence) {
  if (confidence === "high") return "error";
  if (confidence === "medium") return "warning";
  return "default";
}

// Aggregate the per-target latest sample map into one summary for the cards.
//
// ICMP loss is reported separately from transport loss on purpose. Networks
// routinely rate-limit or deprioritise ICMP while serving TCP/HTTPS perfectly,
// so a high ICMP loss rate with healthy transport means "ICMP is filtered",
// not "your network is degraded". Conflating them produces a monitor that cries
// wolf on a working connection.
export const ICMP_LOSS_SUSPECT_PCT = 30;

export function summarizeLatest(latest) {
  const rows = Object.values(latest || {}).filter((r) => r.kind !== "env");
  if (!rows.length) {
    return {
      total: 0, okCount: 0, rttAvgMs: null,
      icmpLossMaxPct: null, transportOk: null, icmpFiltered: false,
    };
  }

  const icmp = rows.filter((r) => r.kind === "icmp");
  const transport = rows.filter((r) => r.kind === "tcp" || r.kind === "dns" || r.kind === "upstream");

  const rtts = rows.map((r) => r.rttAvgMs).filter((v) => v != null);
  const icmpLosses = icmp.map((r) => r.lossPct).filter((v) => v != null);
  const icmpLossMaxPct = icmpLosses.length ? Math.max(...icmpLosses) : null;

  const transportTotal = transport.length;
  const transportOkCount = transport.filter((r) => r.ok).length;
  const transportOk = transportTotal ? transportOkCount > 0 : null;

  // ICMP loss that the transport layer does not corroborate is policy, not
  // congestion — the same rule attribution.js applies, kept in sync so the card
  // and the verdict never disagree. Partial loss counts too.
  const transportAllOk = transportTotal > 0 && transportOkCount === transportTotal;
  const icmpFiltered = Boolean(
    icmp.length
    && transportAllOk
    && (icmp.every((r) => !r.ok) || (icmpLossMaxPct ?? 0) >= ICMP_LOSS_SUSPECT_PCT),
  );

  return {
    total: rows.length,
    okCount: rows.filter((r) => r.ok).length,
    rttAvgMs: rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : null,
    icmpLossMaxPct,
    transportOk,
    transportOkCount,
    transportTotal,
    icmpFiltered,
  };
}

// One line per target. Mixing every target into a single series produced a line
// that jogged between e.g. 40ms (1.1.1.1), 400ms (8.8.8.8) and 5ms (TCP) at the
// same timestamp — pure noise that looked like violent jitter. Targets must be
// pivoted into columns so each probe keeps its own line.
export function pivotSeries(data, dataKey) {
  const rows = (data || []).filter((p) => p.kind !== "env" && p[dataKey] != null);
  if (!rows.length) return { points: [], targets: [] };

  const targets = [...new Set(rows.map((p) => `${p.kind}:${p.target}`))].sort();
  const byTs = new Map();

  for (const row of rows) {
    const ts = row.ts || row.bucket;
    if (!byTs.has(ts)) byTs.set(ts, { ts });
    // A duplicated (ts, target) pair — possible when a retest ran in the same
    // second — would otherwise silently overwrite; last value wins.
    byTs.get(ts)[`${row.kind}:${row.target}`] = row[dataKey];
  }

  const points = [...byTs.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { points, targets };
}

// Recharts needs a colour per target; the palette is the project's chart tokens.
export const SERIES_COLORS = [
  "var(--color-info)",
  "var(--color-warning)",
  "var(--color-success)",
  "var(--color-primary)",
  "var(--color-brand-300)",
];
