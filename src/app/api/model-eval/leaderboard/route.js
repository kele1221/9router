import { NextResponse } from "next/server";
import { getEvalScoreRows } from "@/lib/db/index.js";
import { buildLeaderboard, buildTrend } from "@/lib/modelEval/aggregate.js";

export const dynamic = "force-dynamic";

function periodSince(period) {
  const now = new Date();
  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  if (period === "7d") return new Date(now.getTime() - 7 * 86400000).toISOString();
  if (period === "30d") return new Date(now.getTime() - 30 * 86400000).toISOString();
  return null;
}

// GET /api/model-eval/leaderboard?period=today|7d|30d|all&trendModel=&trendDays=
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const period = url.searchParams.get("period") || "all";
    const trendModel = url.searchParams.get("trendModel");
    const since = periodSince(period);

    const rows = await getEvalScoreRows({ since });
    const leaderboard = buildLeaderboard(rows);

    let trend = null;
    if (trendModel) {
      const days = Math.min(Math.max(Number(url.searchParams.get("trendDays")) || 14, 1), 90);
      const trendSince = new Date(Date.now() - days * 86400000).toISOString();
      const modelRows = await getEvalScoreRows({ since: trendSince, model: trendModel });
      trend = { model: trendModel, days, points: buildTrend(modelRows) };
    }

    return NextResponse.json({ period, leaderboard, trend });
  } catch (error) {
    console.log("Error building eval leaderboard:", error);
    return NextResponse.json({ error: "Failed to build leaderboard" }, { status: 500 });
  }
}
