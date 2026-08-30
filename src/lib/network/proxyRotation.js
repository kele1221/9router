import { getProxyPoolById } from "@/models";
import { getSettings } from "@/lib/localDb";
import { getRotationManager } from "./proxyPoolManager.js";

const RELAY_TYPES = new Set(["vercel", "cloudflare", "deno"]);

const RATE_LIMIT_RE =
  /rate\s*limit|too many requests|\b429\b|limit_reached|usage_limit|quota|retry.?after/i;

const NETWORK_RE =
  /ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|ENETUNREACH|EHOSTUNREACH|socket hang up|fetch failed|network|connect timeout|proxy connect|empty response|aborted/i;

/**
 * Classify an upstream failure for proxy rotation.
 * - rate_limit: 429 or rate-limit text → swap IP, keep account
 * - network: transport errors (surface as 502 + error text) → swap IP
 * - anything else (401/403/5xx/499) → keep account semantics unchanged
 */
export function classifyProxyFailure(status, error) {
  const code = Number(status);
  const text = String(error?.message || error || "");
  if (code === 401 || code === 403 || code === 499) return "no";
  if (code === 429 || RATE_LIMIT_RE.test(text)) return "rate_limit";
  if (NETWORK_RE.test(text)) return "network";
  return "no";
}

/**
 * Failure-driven rotation hook for all handlers.
 * Fail-open: any throw → { rotated:false }, never affects the normal path.
 */
export async function tryRotateProxy(ctx, { credentials = {}, status = 0, error = null } = {}) {
  try {
    if (!ctx || typeof ctx !== "object") return { rotated: false, changed: false, reason: "no-ctx" };
    const settings = await getSettings();
    if (settings?.proxyRotation?.enabled !== true) {
      return { rotated: false, changed: false, reason: "disabled" };
    }

    const pds = credentials?.providerSpecificData || {};
    const proxyUrl = pds.connectionProxyUrl;
    const poolId = pds.connectionProxyPoolId;
    if (pds.connectionProxyEnabled !== true || !proxyUrl || !poolId) {
      return { rotated: false, changed: false, reason: "no-proxy" };
    }

    const pool = await getProxyPoolById(poolId);
    if (!pool) return { rotated: false, changed: false, reason: "no-pool" };
    if (RELAY_TYPES.has(pool.type)) return { rotated: false, changed: false, reason: "relay" };

    const kind = classifyProxyFailure(status, error);
    if (kind === "no") return { rotated: false, changed: false, reason: "not-rotatable" };

    // Budget is initialized lazily from settings so handlers don't need a
    // settings read just to build the ctx.
    if (ctx.rotationBudget == null) {
      ctx.rotationBudget = Number(settings.proxyRotation.maxRotationsPerRequest) || 3;
    }
    if (ctx.rotationBudget <= 0) return { rotated: false, changed: false, reason: "budget" };
    ctx.rotationBudget -= 1;

    ctx.pinnedConnectionId = credentials.connectionId || ctx.pinnedConnectionId || null;
    ctx.proxyExcludes = ctx.proxyExcludes instanceof Set ? ctx.proxyExcludes : new Set(ctx.proxyExcludes || []);
    ctx.proxyExcludes.add(proxyUrl);

    // Clash pool: local controller owns node selection — never freeze the
    // local mixed-port URL in the http manager.
    if (pool.type === "clash") {
      const { clashRotate } = await import("./clashController.js");
      const res = await clashRotate({ credentials, status, error, kind });
      if (res?.success) {
        ctx.pin = null;
        return { rotated: true, changed: true, reason: "clash" };
      }
      return { rotated: false, changed: false, reason: res?.reason || "clash-fail" };
    }

    const manager = getRotationManager();
    await manager.markProxyFailed({ url: proxyUrl, poolId, errorType: kind });
    const next = await manager.pickProxy({
      poolIds: [poolId],
      excludeUrls: ctx.proxyExcludes,
      pinned: null,
    });
    if (!next?.proxyUrl) return { rotated: false, changed: false, reason: "no-candidate" };
    ctx.pin = next.proxyUrl;
    return { rotated: true, changed: true, reason: kind };
  } catch (e) {
    console.warn("[proxyRotation] tryRotateProxy failed:", e?.message);
    return { rotated: false, changed: false, reason: "error" };
  }
}
