import { NextResponse } from "next/server";
import { deleteEvalRun, getEvalResultsByRun, getEvalRunById } from "@/lib/db/index.js";
import { getActiveRun } from "@/lib/modelEval/runner.js";

export const dynamic = "force-dynamic";

// GET /api/model-eval/runs/[id] - run detail with per-model results (polled by the page)
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const run = await getEvalRunById(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const results = await getEvalResultsByRun(id);
    const active = getActiveRun();
    return NextResponse.json({ run, results, active: Boolean(active && active.runId === id) });
  } catch (error) {
    console.log("Error fetching eval run:", error);
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 });
  }
}

// DELETE /api/model-eval/runs/[id]
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    if (getActiveRun()?.runId === id) {
      return NextResponse.json({ error: "评测进行中，请先取消" }, { status: 409 });
    }
    const run = await getEvalRunById(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    await deleteEvalRun(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting eval run:", error);
    return NextResponse.json({ error: "Failed to delete run" }, { status: 500 });
  }
}
