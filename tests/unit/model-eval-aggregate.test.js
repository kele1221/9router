import { describe, expect, it } from "vitest";
import { buildLeaderboard, buildTrend, localDateKey } from "../../src/lib/modelEval/aggregate.js";

const row = (model, { score = null, status = "ok", markers = { hasSvg: true, hasAnimation: true }, latencyMs = 1000, at = "2026-09-23T10:00:00" } = {}) => ({
  model, humanScore: score, status, markers, latencyMs, createdAt: at, startedAt: at,
});

describe("eval leaderboard aggregation", () => {
  it("averages human scores and computes marker rates", () => {
    const rows = [
      row("a/b", { score: 80 }),
      row("a/b", { score: 60 }),
      row("a/b", { status: "error", markers: null }),
    ];
    const [entry] = buildLeaderboard(rows);
    expect(entry).toMatchObject({
      model: "a/b",
      evaluations: 3,
      scoreCount: 2,
      avgScore: 70,
      okRate: 66.7,
      svgRate: 100,
      animRate: 100,
    });
  });

  it("sorts scored models first, then by score, then by sample count", () => {
    const rows = [
      row("z/no-score"),
      row("c/low", { score: 50 }),
      row("b/high", { score: 90 }),
      row("a/high-more-samples", { score: 90 }),
      row("a/high-more-samples", { score: 90 }),
    ];
    expect(buildLeaderboard(rows).map((e) => e.model)).toEqual(["a/high-more-samples", "b/high", "c/low", "z/no-score"]);
  });

  it("reports null rates when nothing produced code", () => {
    const [entry] = buildLeaderboard([row("x/y", { status: "timeout", markers: null, score: 10 })]);
    expect(entry).toMatchObject({ okRate: 0, svgRate: null, animRate: null, avgScore: 10 });
  });

  it("keeps arithmetic correctness independent from visual metrics and scores", () => {
    const [entry] = buildLeaderboard([
      row("a/b", { score: 80 }),
      { ...row("a/b", { score: 0, markers: null }), evaluationType: "arithmetic", autoEvaluation: { verdict: "correct" } },
      { ...row("a/b", { score: 0, markers: null }), evaluationType: "arithmetic", autoEvaluation: { verdict: "invalid" } },
    ]);
    expect(entry).toMatchObject({ evaluations: 1, scoreCount: 1, avgScore: 80, okRate: 100, svgRate: 100, animRate: 100, arithmeticCorrectCount: 1, arithmeticEvaluatedCount: 2, arithmeticCorrectRate: 50 });
  });

  it("returns an empty list for no rows", () => {
    expect(buildLeaderboard([])).toEqual([]);
  });
});

describe("eval trend aggregation", () => {
  it("averages per local day and skips unscored rows", () => {
    const rows = [
      row("a/b", { score: 80, at: new Date(2026, 8, 22, 9, 0, 0).toISOString() }),
      row("a/b", { score: 60, at: new Date(2026, 8, 22, 18, 0, 0).toISOString() }),
      row("a/b", { at: new Date(2026, 8, 23, 9, 0, 0).toISOString() }),
    ];
    const points = buildTrend(rows);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ dateKey: "2026-09-22", avgScore: 70, scoreCount: 2, evaluations: 2 });
    expect(points[1]).toMatchObject({ dateKey: "2026-09-23", avgScore: null, scoreCount: 0, evaluations: 1 });
  });

  it("derives local date keys", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59, 0))).toBe("2026-01-05");
    expect(localDateKey("not a date")).toBeNull();
  });
});
