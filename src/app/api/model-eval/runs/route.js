import { NextResponse } from "next/server";
import { getEvalResultsByRun, getEvalRuns, getEvalRunById } from "@/lib/db/index.js";
import { RunBusyError, getActiveRun, startRun } from "@/lib/modelEval/runner.js";
import { resolvePromptContent } from "@/lib/modelEval/scheduler.js";
import { expandThinkingTargets, MAX_EVAL_TARGETS, normalizeThinkingEfforts } from "@/lib/modelEval/thinkingTargets.js";

export const dynamic = "force-dynamic";

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
    const thinkingEfforts = normalizeThinkingEfforts(body.thinkingEfforts, { defaultNone: false });
    if (thinkingEfforts.length === 0) return NextResponse.json({ error: "请至少选择一个思考深度" }, { status: 400 });

    const promptId = body.promptId ? String(body.promptId) : null;
    const prompt = await resolvePromptContent(promptId);
    if (!prompt) return NextResponse.json({ error: "请选择一个有效的 Prompt" }, { status: 400 });
    const { targets, skipped } = await expandThinkingTargets(models, thinkingEfforts);
    if (targets.length === 0) return NextResponse.json({ error: "所选模型均不支持这些思考深度" }, { status: 400 });
    if (targets.length > MAX_EVAL_TARGETS) return NextResponse.json({ error: `单次最多 ${MAX_EVAL_TARGETS} 个模型与思考深度组合` }, { status: 400 });

    try {
      const run = await startRun({
        promptId,
        promptName: prompt.name,
        promptContent: prompt.content,
        evaluationType: prompt.evaluationType,
        expectedAnswer: prompt.expectedAnswer,
        source: "manual",
        scheduleId: null,
        models,
        thinkingEfforts,
        targets,
      });
      return NextResponse.json({ run, skipped }, { status: 201 });
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
