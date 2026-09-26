// Pure aggregation for the leaderboard. Input rows come straight from
// getEvalScoreRows(); all scoring is human-entered, markers are advisory.

export function localDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const round1 = (n) => Math.round(n * 10) / 10;

// Visual and arithmetic evaluations have intentionally separate denominators:
// an arithmetic answer is a successful request, not a visual generation.
export function buildLeaderboard(rows = []) {
  const byModel = new Map();
  for (const row of rows) {
    if (!row?.model) continue;
    let entry = byModel.get(row.model);
    if (!entry) {
      entry = { model: row.model, evaluations: 0, okCount: 0, svgCount: 0, animCount: 0, scoreSum: 0, scoreCount: 0, latencySum: 0, latencyCount: 0, arithmeticCorrectCount: 0, arithmeticEvaluatedCount: 0, lastAt: null };
      byModel.set(row.model, entry);
    }
    if (row.evaluationType === "arithmetic") {
      if (["correct", "incorrect", "invalid"].includes(row.autoEvaluation?.verdict)) {
        entry.arithmeticEvaluatedCount += 1;
        if (row.autoEvaluation.verdict === "correct") entry.arithmeticCorrectCount += 1;
      }
    } else {
      entry.evaluations += 1;
      if (row.status === "ok") {
        entry.okCount += 1;
        if (row.markers?.hasSvg) entry.svgCount += 1;
        if (row.markers?.hasAnimation) entry.animCount += 1;
      }
      if (typeof row.latencyMs === "number") { entry.latencySum += row.latencyMs; entry.latencyCount += 1; }
      const scored = row.humanScore !== null && row.humanScore !== undefined;
      if (scored) { entry.scoreSum += Number(row.humanScore); entry.scoreCount += 1; }
    }
    const at = row.startedAt || row.createdAt;
    if (at && (!entry.lastAt || at > entry.lastAt)) entry.lastAt = at;
  }

  return [...byModel.values()]
    .map((e) => ({
      model: e.model,
      evaluations: e.evaluations,
      scoreCount: e.scoreCount,
      avgScore: e.scoreCount ? round1(e.scoreSum / e.scoreCount) : null,
      okRate: e.evaluations ? round1((e.okCount / e.evaluations) * 100) : null,
      svgRate: e.okCount ? round1((e.svgCount / e.okCount) * 100) : null,
      animRate: e.okCount ? round1((e.animCount / e.okCount) * 100) : null,
      arithmeticCorrectCount: e.arithmeticCorrectCount,
      arithmeticEvaluatedCount: e.arithmeticEvaluatedCount,
      arithmeticCorrectRate: e.arithmeticEvaluatedCount ? round1((e.arithmeticCorrectCount / e.arithmeticEvaluatedCount) * 100) : null,
      avgLatencyMs: e.latencyCount ? Math.round(e.latencySum / e.latencyCount) : null,
      lastAt: e.lastAt,
    }))
    .sort((a, b) => {
      if (a.avgScore === null && b.avgScore === null) return a.model.localeCompare(b.model);
      if (a.avgScore === null) return 1;
      if (b.avgScore === null) return -1;
      if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
      if (b.scoreCount !== a.scoreCount) return b.scoreCount - a.scoreCount;
      return a.model.localeCompare(b.model);
    });
}

// rows for one model → [{ dateKey, avgScore, scoreCount, evaluations }] ascending
export function buildTrend(rows = []) {
  const byDay = new Map();
  for (const row of rows) {
    if (row.evaluationType === "arithmetic") continue;
    const key = localDateKey(row.startedAt || row.createdAt);
    if (!key) continue;
    const entry = byDay.get(key) || { dateKey: key, scoreSum: 0, scoreCount: 0, evaluations: 0 };
    entry.evaluations += 1;
    if (row.humanScore !== null && row.humanScore !== undefined) {
      entry.scoreSum += Number(row.humanScore);
      entry.scoreCount += 1;
    }
    byDay.set(key, entry);
  }
  return [...byDay.values()]
    .map((e) => ({
      dateKey: e.dateKey,
      avgScore: e.scoreCount ? round1(e.scoreSum / e.scoreCount) : null,
      scoreCount: e.scoreCount,
      evaluations: e.evaluations,
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}
