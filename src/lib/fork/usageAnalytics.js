function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function top(items, limit) {
  return items.slice(0, Math.max(1, number(limit) || 6));
}

export function buildUsageAnalytics(stats, { limit = 6 } = {}) {
  if (!stats || typeof stats !== "object") {
    return {
      modelRequests: [],
      providerTokens: [],
      tokenComposition: [],
      apiKeyUsage: [],
    };
  }

  const modelRequests = top(
    Object.entries(stats.byModel || {})
      .map(([key, item]) => ({
        name: item.rawModel || key,
        provider: item.provider || "unknown",
        requests: number(item.requests),
      }))
      .filter((item) => item.requests > 0)
      .sort((left, right) => right.requests - left.requests),
    limit,
  );

  const providerTokens = top(
    Object.entries(stats.byProvider || {})
      .map(([name, item]) => ({
        name,
        value: number(item.promptTokens) + number(item.completionTokens),
        cost: number(item.cost),
      }))
      .filter((item) => item.value > 0)
      .sort((left, right) => right.value - left.value),
    limit,
  );

  const promptTokens = number(stats.totalPromptTokens);
  const cachedTokens = Math.min(promptTokens, number(stats.totalCachedTokens));
  const tokenComposition = [
    { name: "Non-cached input", value: Math.max(0, promptTokens - cachedTokens) },
    { name: "Cached input", value: cachedTokens },
    { name: "Output", value: number(stats.totalCompletionTokens) },
  ].filter((item) => item.value > 0);

  const apiKeyMap = new Map();
  for (const item of Object.values(stats.byApiKey || {})) {
    const name = item.keyName || item.apiKeyMasked || "Local (No API Key)";
    const current = apiKeyMap.get(name) || { name, requests: 0, tokens: 0 };
    current.requests += number(item.requests);
    current.tokens += number(item.promptTokens) + number(item.completionTokens);
    apiKeyMap.set(name, current);
  }
  const apiKeyUsage = top(
    [...apiKeyMap.values()]
      .filter((item) => item.requests > 0 || item.tokens > 0)
      .sort((left, right) => right.requests - left.requests || right.tokens - left.tokens),
    limit,
  );

  return { modelRequests, providerTokens, tokenComposition, apiKeyUsage };
}
