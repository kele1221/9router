const PERIOD_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "60d": 60 * 24 * 60 * 60 * 1000,
};

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampMs(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isErrorStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "error"
    || normalized === "failed"
    || normalized.startsWith("failed ")
    || /^[45]\d\d(?:\s|$)/.test(normalized);
}

function tokenDetails(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function cachedTokens(row) {
  const tokens = tokenDetails(row.tokens);
  return number(tokens.cached_tokens)
    || number(tokens.cache_read_input_tokens)
    || number(tokens.cached_input_tokens);
}

function emptyAnalytics() {
  return {
    modelStats: [],
    requestTrend: [],
    tokenDistribution: [],
    apiKeyStats: [],
    coverage: { requestSamples: 0, oldestRequestAt: null },
  };
}

export function getUsagePeriodStart(period, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  if (period === "all") return null;
  if (period === "today") {
    const start = new Date(nowDate);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  const duration = PERIOD_MS[period] || PERIOD_MS["24h"];
  return new Date(nowDate.getTime() - duration);
}

function inPeriod(row, startMs, nowMs) {
  const time = timestampMs(row.timestamp);
  return time != null && time <= nowMs && (startMs == null || time >= startMs);
}

function bucketSettings(period, nowDate) {
  if (period === "today") {
    const start = new Date(nowDate);
    start.setHours(0, 0, 0, 0);
    return {
      count: Math.max(1, Math.floor((nowDate.getTime() - start.getTime()) / 3600000) + 1),
      size: 3600000,
    };
  }
  if (period === "7d") return { count: 28, size: 6 * 3600000 };
  if (period === "30d") return { count: 30, size: 24 * 3600000 };
  if (period === "60d") return { count: 30, size: 2 * 24 * 3600000 };
  if (period === "all") return { count: 30, size: 24 * 3600000 };
  return { count: 24, size: 3600000 };
}

function buildRequestTrend(events, period, nowDate, limit) {
  if (!events.length) return [];

  const requestCounts = new Map();
  for (const event of events) {
    const model = String(event.model || "未知模型");
    requestCounts.set(model, (requestCounts.get(model) || 0) + 1);
  }
  const models = [...requestCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([model]) => model);
  const modelSet = new Set(models);

  const { count, size } = bucketSettings(period, nowDate);
  const endExclusive = Math.floor(nowDate.getTime() / size) * size + size;
  const start = endExclusive - count * size;
  const buckets = Array.from({ length: count }, (_, index) => {
    const bucket = { timestamp: new Date(start + index * size).toISOString() };
    for (const model of models) bucket[model] = 0;
    return bucket;
  });

  for (const event of events) {
    const model = String(event.model || "未知模型");
    if (!modelSet.has(model)) continue;
    const time = timestampMs(event.timestamp);
    const index = time == null ? -1 : Math.floor((time - start) / size);
    if (index >= 0 && index < buckets.length) buckets[index][model] += 1;
  }
  return buckets;
}

export function buildUsageAnalytics(input = {}, {
  period = "24h",
  now = new Date(),
  limit = 5,
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const start = getUsagePeriodStart(period, nowDate);
  const startMs = start?.getTime() ?? null;
  const usageRows = (Array.isArray(input.usageRows) ? input.usageRows : [])
    .filter((row) => inPeriod(row, startMs, nowMs));
  const detailRows = (Array.isArray(input.detailRows) ? input.detailRows : [])
    .filter((row) => inPeriod(row, startMs, nowMs));
  const apiKeyNames = input.apiKeyNames && typeof input.apiKeyNames === "object"
    ? input.apiKeyNames
    : {};

  if (!usageRows.length && !detailRows.length) return emptyAnalytics();

  const models = new Map();
  const ensureModel = (name) => {
    const model = String(name || "未知模型");
    if (!models.has(model)) {
      models.set(model, {
        model,
        usageRequests: 0,
        usageErrors: 0,
        detailRequests: 0,
        detailErrors: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        latencyTotal: 0,
        latencyCount: 0,
      });
    }
    return models.get(model);
  };

  const apiKeys = new Map();
  for (const row of usageRows) {
    const model = ensureModel(row.model);
    model.usageRequests += 1;
    if (isErrorStatus(row.status)) model.usageErrors += 1;
    model.inputTokens += number(row.promptTokens);
    model.outputTokens += number(row.completionTokens);
    model.cachedTokens += cachedTokens(row);

    const rawKey = typeof row.apiKey === "string" ? row.apiKey : "";
    const name = rawKey
      ? (apiKeyNames[rawKey] || `${rawKey.slice(0, 8)}...`)
      : "本地调用（无 API Key）";
    const item = apiKeys.get(name) || { name, totalRequests: 0, totalErrors: 0 };
    item.totalRequests += 1;
    if (isErrorStatus(row.status)) item.totalErrors += 1;
    apiKeys.set(name, item);
  }

  for (const row of detailRows) {
    const model = ensureModel(row.model);
    model.detailRequests += 1;
    if (isErrorStatus(row.status)) model.detailErrors += 1;
    const latency = number(row.latency?.total);
    if (latency > 0) {
      model.latencyTotal += latency;
      model.latencyCount += 1;
    }
  }

  const modelStats = [...models.values()]
    .map((model) => {
      const totalErrors = Math.max(model.detailErrors, model.usageErrors);
      const totalRequests = model.usageRequests > 0
        ? model.usageRequests + model.detailErrors
        : model.detailRequests;
      return {
        model: model.model,
        totalRequests,
        totalErrors,
        errorRate: totalRequests > 0 ? Number(((totalErrors / totalRequests) * 100).toFixed(1)) : 0,
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
        cachedTokens: model.cachedTokens,
        avgLatencyMs: model.latencyCount > 0 ? Math.round(model.latencyTotal / model.latencyCount) : 0,
      };
    })
    .filter((model) => model.totalRequests > 0 || model.inputTokens + model.outputTokens > 0)
    .sort((left, right) => right.totalRequests - left.totalRequests || left.model.localeCompare(right.model));

  const tokenDistribution = [...models.values()]
    .map((model) => ({ name: model.model, value: model.inputTokens + model.outputTokens }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name));

  const apiKeyStats = [...apiKeys.values()]
    .sort((left, right) => right.totalRequests - left.totalRequests || left.name.localeCompare(right.name));

  const modelsWithUsage = new Set(usageRows.map((row) => String(row.model || "未知模型")));
  const trendEvents = [
    ...usageRows,
    ...detailRows.filter((row) => isErrorStatus(row.status) || !modelsWithUsage.has(String(row.model || "未知模型"))),
  ];
  const requestTrend = buildRequestTrend(trendEvents, period, nowDate, Math.max(1, number(limit) || 5));
  const detailTimes = detailRows.map((row) => row.timestamp).filter(Boolean).sort();

  return {
    modelStats,
    requestTrend,
    tokenDistribution,
    apiKeyStats,
    coverage: {
      requestSamples: detailRows.length,
      oldestRequestAt: detailTimes[0] || null,
    },
  };
}
