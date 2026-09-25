import { NextResponse } from "next/server";
import { getEvalResultsByRun, getEvalRunById } from "@/lib/db/index.js";
import { createZip, safeEntryName } from "@/lib/modelEval/zip.js";

export const dynamic = "force-dynamic";

export function sourceExtension(result) {
  if (result?.markers?.hasSvg && !/<!doctype\s+html|<html[\s>]/i.test(result.code || "")) return "svg";
  return "html";
}

// GET /api/model-eval/runs/[id]/download - ZIP of every generated source file
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const run = await getEvalRunById(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const model = new URL(request.url).searchParams.get("model");
    const results = (await getEvalResultsByRun(id)).filter((r) => r.code && (!model || r.model === model));
    if (results.length === 0) return NextResponse.json({ error: "该轮评测没有可导出的源码" }, { status: 404 });

    const used = new Set();
    const entries = results.map((result, index) => {
      const name = safeEntryName(`${result.model}-${result.thinkingEffort || "none"}`, index, used);
      const ext = sourceExtension(result);
      return {
        name: `${name.slice(0, -".html".length)}.${ext}`,
        data: result.code,
      };
    });

    const zip = createZip(entries);
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="model-eval-${id}${model ? "-model" : ""}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.log("Error exporting eval run:", error);
    return NextResponse.json({ error: "Failed to export run" }, { status: 500 });
  }
}
