import { NextResponse } from "next/server";
import { deleteEvalSchedule, getEvalScheduleById, updateEvalSchedule } from "@/lib/db/index.js";
import { sanitizeScheduleInput } from "@/lib/modelEval/scheduleInput.js";
import { resolvePromptContent } from "@/lib/modelEval/scheduler.js";

export const dynamic = "force-dynamic";

// PATCH /api/model-eval/schedules/[id]
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getEvalScheduleById(id);
    if (!existing) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    // Merge then validate: one shape check covers both full and partial patches.
    const { value, error } = sanitizeScheduleInput({
      name: body.name !== undefined ? body.name : existing.name,
      models: body.models !== undefined ? body.models : existing.models,
      promptId: body.promptId !== undefined ? body.promptId : existing.promptId,
      mode: body.mode !== undefined ? body.mode : existing.mode,
      dailyTime: body.dailyTime !== undefined ? body.dailyTime : existing.dailyTime,
      cronExpr: body.cronExpr !== undefined ? body.cronExpr : existing.cronExpr,
      enabled: body.enabled !== undefined ? body.enabled : existing.enabled,
    });
    if (error) return NextResponse.json({ error }, { status: 400 });

    const prompt = await resolvePromptContent(value.promptId);
    if (!prompt) return NextResponse.json({ error: "Prompt 不存在" }, { status: 400 });

    const schedule = await updateEvalSchedule(id, value);
    return NextResponse.json({ schedule });
  } catch (error) {
    console.log("Error updating eval schedule:", error);
    return NextResponse.json({ error: "Failed to update schedule" }, { status: 500 });
  }
}

// DELETE /api/model-eval/schedules/[id]
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    await deleteEvalSchedule(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting eval schedule:", error);
    return NextResponse.json({ error: "Failed to delete schedule" }, { status: 500 });
  }
}
