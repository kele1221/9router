import { NextResponse } from "next/server";
import { getEvalResultById } from "@/lib/db/index.js";
import { safeEntryName } from "@/lib/modelEval/zip.js";

export const dynamic = "force-dynamic";

// GET /api/model-eval/results/[id]/download?format=html|svg
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const format = (new URL(request.url).searchParams.get("format") || "").toLowerCase();
    const result = await getEvalResultById(id);
    if (!result) return NextResponse.json({ error: "Result not found" }, { status: 404 });
    if (!result.code) return NextResponse.json({ error: "该结果没有生成源码" }, { status: 404 });

    const used = new Set();
    const base = safeEntryName(result.model, 0, used).slice(0, -".html".length);
    const ext = format === "svg" ? "svg" : format === "html" ? "html" : (result.markers?.hasSvg && !/<html[\s>]/i.test(result.code) ? "svg" : "html");

    return new Response(result.code, {
      headers: {
        "Content-Type": ext === "svg" ? "image/svg+xml; charset=utf-8" : "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.${ext}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.log("Error downloading eval result:", error);
    return NextResponse.json({ error: "Failed to download result" }, { status: 500 });
  }
}
