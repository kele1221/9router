import { getForkUsageDashboard } from "@/lib/fork/usageDashboard.js";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  const period = new URL(request.url).searchParams.get("period") || "24h";
  if (!VALID_PERIODS.has(period)) {
    return Response.json({ error: "Invalid period" }, { status: 400 });
  }

  try {
    const data = await getForkUsageDashboard(period);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[FORK_USAGE_DASHBOARD] Failed to load chart data:", error);
    return Response.json(
      { error: "Failed to load usage dashboard" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
