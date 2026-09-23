import { NextResponse } from "next/server";
import { RunBusyError, retryResults } from "@/lib/modelEval/runner.js";

export const dynamic = "force-dynamic";

// POST /api/model-eval/runs/[id]/retry - re-runs failed models of an existing run.
// Body: { resultIds?: string[] } — omit to retry every non-ok model.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const resultIds = Array.isArray(body.resultIds) ? body.resultIds.map(String) : null;

    const result = await retryResults({ runId: id, resultIds });
    if (!result) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (!result.retried) return NextResponse.json({ error: "没有可重试的结果" }, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RunBusyError) {
      return NextResponse.json({ error: "已有评测正在运行，请等待结束或先取消" }, { status: 409 });
    }
    console.log("Error retrying eval results:", err);
    return NextResponse.json({ error: "Failed to retry" }, { status: 500 });
  }
}
