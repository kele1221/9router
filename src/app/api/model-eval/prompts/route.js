import { NextResponse } from "next/server";
import { createEvalPrompt, getEvalPrompts } from "@/lib/db/index.js";
import { BUILTIN_EVAL_PROMPTS, isBuiltinPromptId } from "@/shared/constants/evalPrompts.js";

export const dynamic = "force-dynamic";

// GET /api/model-eval/prompts - built-in presets (with any user override applied)
// merged with user-created prompts
export async function GET() {
  try {
    const stored = await getEvalPrompts();
    const overrides = new Map(stored.filter((p) => isBuiltinPromptId(p.id)).map((p) => [p.id, p]));

    const prompts = [
      ...BUILTIN_EVAL_PROMPTS.map((builtin) => {
        const override = overrides.get(builtin.id);
        return override
          ? { id: builtin.id, name: override.name, content: override.content, builtin: true, overridden: true, updatedAt: override.updatedAt }
          : { ...builtin, builtin: true, overridden: false, updatedAt: null };
      }),
      ...stored.filter((p) => !isBuiltinPromptId(p.id)).map((p) => ({ ...p, builtin: false, overridden: false })),
    ];
    return NextResponse.json({ prompts });
  } catch (error) {
    console.log("Error fetching eval prompts:", error);
    return NextResponse.json({ error: "Failed to fetch prompts" }, { status: 500 });
  }
}

// POST /api/model-eval/prompts - create a custom prompt
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const content = String(body.content || "").trim();
    if (!name) return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
    if (!content) return NextResponse.json({ error: "Prompt 内容不能为空" }, { status: 400 });
    const prompt = await createEvalPrompt({ name, content });
    return NextResponse.json({ prompt: { ...prompt, builtin: false } }, { status: 201 });
  } catch (error) {
    console.log("Error creating eval prompt:", error);
    return NextResponse.json({ error: "Failed to create prompt" }, { status: 500 });
  }
}
