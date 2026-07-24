import { getRateLimitNormalizationSummary } from "@/lib/fork/rateLimitNormalization.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await getRateLimitNormalizationSummary();
    return Response.json(summary, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[RATE_LIMIT_NORMALIZED] Failed to load dashboard summary:", error);
    return Response.json(
      { error: "Failed to load rate-limit normalization summary" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
