import { NextResponse } from "next/server";
import { getEvalResultsByModel } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

// GET /api/model-eval/results?model=<name>&limit=100&offset=0
// Every stored generation for one model, newest run first (leaderboard preview browser).
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const model = String(url.searchParams.get("model") || "").trim();
    if (!model) return NextResponse.json({ error: "缺少 model 参数" }, { status: 400 });
    const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
    const page = await getEvalResultsByModel(model, { limit: limit + 1, offset });
    const hasMore = page.length > limit;
    const results = hasMore ? page.slice(0, limit) : page;
    return NextResponse.json({ model, results, hasMore });
  } catch (error) {
    console.log("Error fetching eval results by model:", error);
    return NextResponse.json({ error: "Failed to fetch results" }, { status: 500 });
  }
}
