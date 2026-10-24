import { NextResponse } from "next/server";
import { isLocalRequest } from "@/dashboardGuard";
import { runAction, ACTIONS, getActionAvailability } from "@/lib/netMonitor/actions.js";

export const dynamic = "force-dynamic";

// Remediation entry point. dashboardGuard already restricts this path to local
// callers (LOCAL_ONLY_PATHS); the check below is defence in depth — a future
// guard change must not silently expose these actions to the network.
export async function POST(request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "Local only" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = body?.action;

    if (!action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }
    if (!ACTIONS[action]) {
      return NextResponse.json(
        { error: `Unknown action (expected ${Object.keys(ACTIONS).join(", ")})` },
        { status: 400 },
      );
    }

    const result = await runAction(action, { sudoPassword: body.sudoPassword });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Never leak a stack trace to the client; the reason goes to the server log.
    console.error("[NET_MONITOR] action failed:", error);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const availability = await getActionAvailability();
    return NextResponse.json(
      { actions: Object.entries(ACTIONS).map(([id, def]) => ({ id, ...def, ...availability[id] })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[NET_MONITOR] action availability failed:", error);
    return NextResponse.json({ error: "Failed to read action availability" }, { status: 500 });
  }
}
