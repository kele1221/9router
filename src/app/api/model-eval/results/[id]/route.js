import { NextResponse } from "next/server";
import { setEvalResultScore } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

// PATCH /api/model-eval/results/[id] - human score + note
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const rawScore = body.humanScore;
    if (rawScore !== null && rawScore !== undefined && rawScore !== "" && !Number.isFinite(Number(rawScore))) {
      return NextResponse.json({ error: "分数必须是数字" }, { status: 400 });
    }
    const result = await setEvalResultScore(id, {
      humanScore: rawScore === "" ? null : rawScore,
      humanNote: body.humanNote === undefined ? null : String(body.humanNote).slice(0, 2000),
    });
    if (!result) return NextResponse.json({ error: "Result not found" }, { status: 404 });
    return NextResponse.json({ result });
  } catch (error) {
    const badScore = /between 0 and 100/.test(error?.message || "");
    if (badScore) return NextResponse.json({ error: "分数需在 0-100 之间" }, { status: 400 });
    console.log("Error scoring eval result:", error);
    return NextResponse.json({ error: "Failed to score result" }, { status: 500 });
  }
}
