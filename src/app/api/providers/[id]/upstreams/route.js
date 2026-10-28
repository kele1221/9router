import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { getExecutor } from "open-sse/executors/index.js";
import { getModelUpstreamPin } from "open-sse/config/providerModels.js";
import { extraUpstreamsFromError } from "open-sse/shared/clinePassRouting.js";

// A pin naming a channel that cannot exist makes the router disclose every
// channel it could have used instead of serving the request, so one probe both
// proves the pin is reaching the gateway and discovers the list.
const IMPOSSIBLE_UPSTREAM = "__9router_probe__";

/**
 * GET /api/providers/{id}/upstreams?model=cline-pass/deepseek-v4.1-flash
 * → { pinned, upstreams, reachable }
 *
 * `upstreams` empty means the gateway served (or ignored) the request instead of
 * refusing the pin, i.e. the pin is not honoured. `reachable: false` means the
 * probe itself failed (network/credential) and says nothing about the pin.
 */
export async function GET(request, { params }) {
  const { id: providerId } = await params;
  const model = new URL(request.url).searchParams.get("model");
  if (!model) return NextResponse.json({ error: "model is required" }, { status: 400 });

  const pinned = getModelUpstreamPin(providerId, model);
  const connection = await getProviderConnectionById(providerId);
  if (!connection) return NextResponse.json({ pinned, upstreams: [], reachable: false, error: "no active connection" }, { status: 404 });

  let message;
  try {
    const { response } = await getExecutor(providerId).execute({
      model,
      body: {
        model,
        stream: false,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
        provider: { only: [IMPOSSIBLE_UPSTREAM] },
        providerOptions: { gateway: { only: [IMPOSSIBLE_UPSTREAM] } },
      },
      stream: false,
      credentials: connection,
    });
    message = (await response.text().catch(() => "")).slice(0, 4000);
  } catch (error) {
    return NextResponse.json({ pinned, upstreams: [], reachable: false, error: error?.message || String(error) });
  }

  const upstreams = extraUpstreamsFromError(message);
  return NextResponse.json({ pinned, upstreams, reachable: upstreams.length > 0 });
}
