import { NextResponse } from "next/server";
import { cancelRun } from "@/lib/modelEval/runner.js";

export const dynamic = "force-dynamic";

// POST /api/model-eval/runs/[id]/cancel - cancels between models, aborts the in-flight one
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const canceled = await cancelRun(id);
    if (!canceled) return NextResponse.json({ error: "该评测未在运行" }, { status: 409 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error canceling eval run:", error);
    return NextResponse.json({ error: "Failed to cancel run" }, { status: 500 });
  }
}
