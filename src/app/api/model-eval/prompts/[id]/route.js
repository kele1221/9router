import { NextResponse } from "next/server";
import {
  deleteEvalPrompt, getEvalPromptById, updateEvalPrompt, upsertEvalPromptOverride,
} from "@/lib/db/index.js";
import { findBuiltinPrompt, isBuiltinPromptId } from "@/shared/constants/evalPrompts.js";

export const dynamic = "force-dynamic";

// PATCH /api/model-eval/prompts/[id]
// Built-in ids are editable: the edit is stored as an override row under the
// same id, so the shipped preset stays recoverable via DELETE.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const builtin = isBuiltinPromptId(id) ? findBuiltinPrompt(id) : null;
    const existing = builtin ? (await getEvalPromptById(id)) || builtin : await getEvalPromptById(id);
    if (!existing) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const name = body.name !== undefined ? String(body.name).trim() : existing.name;
    const content = body.content !== undefined ? String(body.content).trim() : existing.content;
    if (!name) return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
    if (!content) return NextResponse.json({ error: "Prompt 内容不能为空" }, { status: 400 });

    const prompt = builtin
      ? await upsertEvalPromptOverride({ id, name, content })
      : await updateEvalPrompt(id, { name, content });
    return NextResponse.json({ prompt: { ...prompt, builtin: Boolean(builtin), overridden: Boolean(builtin) } });
  } catch (error) {
    console.log("Error updating eval prompt:", error);
    return NextResponse.json({ error: "Failed to update prompt" }, { status: 500 });
  }
}

// DELETE /api/model-eval/prompts/[id]
// Built-in ids: removes the override and restores the shipped prompt (the preset
// itself can never be deleted). Custom ids: deletes the prompt.
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    await deleteEvalPrompt(id);
    return NextResponse.json({ success: true, restored: isBuiltinPromptId(id) });
  } catch (error) {
    console.log("Error deleting eval prompt:", error);
    return NextResponse.json({ error: "Failed to delete prompt" }, { status: 500 });
  }
}
