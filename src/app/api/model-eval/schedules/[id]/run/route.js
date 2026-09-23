import { NextResponse } from "next/server";
import { getEvalScheduleById, updateEvalSchedule } from "@/lib/db/index.js";
import { RunBusyError, startRun } from "@/lib/modelEval/runner.js";
import { resolvePromptContent } from "@/lib/modelEval/scheduler.js";

export const dynamic = "force-dynamic";

// POST /api/model-eval/schedules/[id]/run - trigger this schedule once, now
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const schedule = await getEvalScheduleById(id);
    if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    if (!schedule.models?.length) return NextResponse.json({ error: "该任务没有配置模型" }, { status: 400 });

    const prompt = await resolvePromptContent(schedule.promptId);
    if (!prompt) return NextResponse.json({ error: "Prompt 不存在" }, { status: 400 });

    try {
      const run = await startRun({
        promptId: schedule.promptId,
        promptName: prompt.name,
        promptContent: prompt.content,
        source: "manual",
        scheduleId: schedule.id,
        models: schedule.models,
      });
      await updateEvalSchedule(schedule.id, {
        lastRunAt: new Date().toISOString(),
        lastRunId: run.id,
        lastError: null,
      });
      return NextResponse.json({ run }, { status: 201 });
    } catch (err) {
      if (err instanceof RunBusyError) {
        return NextResponse.json({ error: "已有评测正在运行，请稍后再试" }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    console.log("Error running eval schedule:", error);
    return NextResponse.json({ error: "Failed to run schedule" }, { status: 500 });
  }
}
