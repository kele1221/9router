import { NextResponse } from "next/server";
import { createEvalSchedule, getEvalSchedules } from "@/lib/db/index.js";
import { sanitizeScheduleInput } from "@/lib/modelEval/scheduleInput.js";
import { resolvePromptContent } from "@/lib/modelEval/scheduler.js";

export const dynamic = "force-dynamic";

// GET /api/model-eval/schedules
export async function GET() {
  try {
    return NextResponse.json({ schedules: await getEvalSchedules() });
  } catch (error) {
    console.log("Error fetching eval schedules:", error);
    return NextResponse.json({ error: "Failed to fetch schedules" }, { status: 500 });
  }
}

// POST /api/model-eval/schedules
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { value, error } = sanitizeScheduleInput(body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const prompt = await resolvePromptContent(value.promptId);
    if (!prompt) return NextResponse.json({ error: "Prompt 不存在" }, { status: 400 });

    const schedule = await createEvalSchedule(value);
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (error) {
    console.log("Error creating eval schedule:", error);
    return NextResponse.json({ error: "Failed to create schedule" }, { status: 500 });
  }
}
