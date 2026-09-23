import { NextResponse } from "next/server";
import { getEvalResultsByRun, getEvalRuns, getEvalRunById } from "@/lib/db/index.js";
import { RunBusyError, getActiveRun, startRun } from "@/lib/modelEval/runner.js";
import { resolvePromptContent } from "@/lib/modelEval/scheduler.js";

export const dynamic = "force-dynamic";

const MAX_MODELS = 50;

// GET /api/model-eval/runs - history plus whatever is running right now
export async function GET(request) {
  try {
    const limit = Math.min(Number(new URL(request.url).searchParams.get("limit")) || 50, 200);
    const runs = await getEvalRuns({ limit });
    const active = getActiveRun();
    let activeRun = null;
    if (active) {
      const run = await getEvalRunById(active.runId);
      const results = run ? await getEvalResultsByRun(run.id) : [];
      activeRun = { run, results };
    }
    return NextResponse.json({ runs, active: activeRun });
  } catch (error) {
    console.log("Error fetching eval runs:", error);
    return NextResponse.json({ error: "Failed to fetch runs" }, { status: 500 });
  }
}

// POST /api/model-eval/runs - start a manual evaluation
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const models = [...new Set((Array.isArray(body.models) ? body.models : []).map((m) => String(m || "").trim()).filter(Boolean))];
    if (models.length === 0) return NextResponse.json({ error: "请至少选择一个模型" }, { status: 400 });
    if (models.length > MAX_MODELS) return NextResponse.json({ error: `单次最多 ${MAX_MODELS} 个模型` }, { status: 400 });

    const promptId = body.promptId ? String(body.promptId) : null;
    const prompt = await resolvePromptContent(promptId);
    if (!prompt) return NextResponse.json({ error: "请选择一个有效的 Prompt" }, { status: 400 });

    try {
      const run = await startRun({
        promptId,
        promptName: prompt.name,
        promptContent: prompt.content,
        source: "manual",
        scheduleId: null,
        models,
      });
      return NextResponse.json({ run }, { status: 201 });
    } catch (err) {
      if (err instanceof RunBusyError) {
        return NextResponse.json({ error: "已有评测正在运行，请等待结束或先取消" }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    console.log("Error starting eval run:", error);
    return NextResponse.json({ error: "Failed to start run" }, { status: 500 });
  }
}
