import { collectForkUpdateStatus } from "@/lib/fork/updateStatus.js";

const CACHE_TTL_MS = 60 * 60 * 1000;
const statusCache = (global.__forkUpdateStatusCache ??= {
  value: null,
  fetchedAt: 0,
});

export const dynamic = "force-dynamic";

export async function GET(request) {
  const now = Date.now();
  const forceRefresh = request
    ? new URL(request.url).searchParams.get("refresh") === "1"
    : false;

  if (!forceRefresh && statusCache.value && now - statusCache.fetchedAt < CACHE_TTL_MS) {
    return Response.json(statusCache.value);
  }

  const status = await collectForkUpdateStatus();
  statusCache.value = status;
  statusCache.fetchedAt = now;
  return Response.json(status);
}
