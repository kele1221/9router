import { NextResponse } from "next/server";
import { getSchedulerState } from "@/lib/netMonitor/scheduler.js";
import { summarize, LAYERS } from "@/lib/netMonitor/attribution.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { verdict } = getSchedulerState();
    if (!verdict) {
      return NextResponse.json({
        ready: false,
        layer: null,
        summary: null,
        reasons: [],
        hint: "尚无采集数据，等待首轮探测完成",
      }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({
      ready: true,
      layer: verdict.layer,
      label: LAYER_LABELS[verdict.layer] || verdict.layer,
      confidence: verdict.confidence,
      pending: verdict.pending,
      streak: verdict.streak,
      reasons: verdict.reasons,
      summary: summarize(verdict),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[NET_MONITOR] attribution failed:", error);
    return NextResponse.json({ error: "Failed to read attribution" }, { status: 500 });
  }
}

const LAYER_LABELS = {
  [LAYERS.LOCAL]: "本机网络",
  [LAYERS.DNS]: "DNS 解析",
  [LAYERS.VPN]: "VPN",
  [LAYERS.PROXY]: "代理",
  [LAYERS.UPSTREAM]: "上游服务",
  // `unknown` means "no fault identified", not "something unknown is wrong".
  [LAYERS.UNKNOWN]: "未发现异常",
};
