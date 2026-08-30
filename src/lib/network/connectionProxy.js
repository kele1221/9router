import { getProxyPoolById } from "@/models";
import { getSettings } from "@/lib/localDb";
import { getRotationManager } from "./proxyPoolManager.js";

// Safely normalize any value into a trimmed string.
function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// ─── Proxy pool rotation state (in-memory) ─────────────────────────
const rotateState = new Map(); // providerId → { index }

/**
 * Pick one proxy pool ID from a list based on strategy.
 * round-robin: cycle sequentially (in-memory, resets on restart)
 * random:      uniform random pick
 * none/single: return first entry
 */
export function pickProxyPoolId(poolIds, strategy, providerId) {
  if (!poolIds || poolIds.length === 0) return null;
  if (poolIds.length === 1) return poolIds[0];

  if (strategy === "round-robin") {
    const state = rotateState.get(providerId) || { index: -1 };
    state.index = (state.index + 1) % poolIds.length;
    rotateState.set(providerId, state);
    return poolIds[state.index];
  }

  if (strategy === "random") {
    return poolIds[Math.floor(Math.random() * poolIds.length)];
  }

  return poolIds[0]; // "none" or unknown
}

/**
 * Normalize legacy proxy configuration.
 */
function normalizeLegacyProxy(providerSpecificData = {}) {
  const connectionProxyEnabled =
    providerSpecificData?.connectionProxyEnabled === true;

  const connectionProxyUrl = normalizeString(
    providerSpecificData?.connectionProxyUrl
  );

  const connectionNoProxy = normalizeString(
    providerSpecificData?.connectionNoProxy
  );

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

/**
 * Resolve final proxy configuration.
 *
 * Priority:
 * 1. Proxy Pool
 * 2. Legacy Proxy
 * 3. No Proxy
 */
export async function resolveConnectionProxyConfig(
  providerSpecificData = {},
  options = {}
) {
  try {
    const proxyPoolIdRaw = normalizeString(
      providerSpecificData?.proxyPoolId
    );

    // "__none__" means explicitly disabled
    const proxyPoolId =
      proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;

    const legacy = normalizeLegacyProxy(providerSpecificData);

    /**
     * -----------------------------
     * Proxy Pool Resolution
     * -----------------------------
     */
    if (proxyPoolId) {
      const proxyPool = await getProxyPoolById(proxyPoolId);

      const proxyUrl = normalizeString(proxyPool?.proxyUrl);
      const noProxy = normalizeString(proxyPool?.noProxy);

      const isValidPool =
        proxyPool &&
        proxyPool.isActive === true &&
        proxyUrl;

      if (isValidPool) {
        /**
         * Vercel/Cloudflare relay proxies use base URL rewriting
         * instead of HTTP_PROXY environment variables.
         */
        if (proxyPool.type === "vercel" || proxyPool.type === "cloudflare" || proxyPool.type === "deno") {
          return {
            source: proxyPool.type,

            proxyPoolId,
            proxyPool,

            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: noProxy,

            strictProxy: proxyPool.strictProxy === true,

            vercelRelayUrl: proxyUrl, // Still mapped to vercelRelayUrl in the unified payload since they use the exact same header spec
          };
        }

        /**
         * Clash/Mihomo pool: all traffic goes through the local controller's
         * mixed port; the controller owns node selection. strictProxy defaults
         * to true so a dead controller fails the request instead of leaking
         * the real egress IP through the direct fallback.
         */
        if (proxyPool.type === "clash") {
          const mixedPort = proxyPool.clash?.mixedPort || proxyPool.mixedPort || 7890;
          return {
            source: "clash",

            proxyPoolId,
            proxyPool,

            connectionProxyEnabled: true,
            connectionProxyUrl: `socks5://127.0.0.1:${mixedPort}`,
            connectionNoProxy: noProxy,

            strictProxy: true,
          };
        }

        /**
         * Standard proxy pool
         */
        const wantsRotation =
          proxyPool.rotationEnabled === true ||
          Boolean(proxyPool.groupId) ||
          (Array.isArray(providerSpecificData.proxyPoolIds) &&
            providerSpecificData.proxyPoolIds.length > 1);

        if (wantsRotation && options?.rotation) {
          try {
            const settings = await getSettings();
            if (settings?.proxyRotation?.enabled === true) {
              const manager = getRotationManager();
              const pick = await manager.pickProxy({
                poolIds: [proxyPoolId],
                excludeUrls: options.rotation.proxyExcludes,
                pinned: options.rotation.pin,
              });
              if (pick?.proxyUrl) {
                return {
                  source: "pool",

                  proxyPoolId: pick.poolId,
                  proxyPool: null,

                  connectionProxyEnabled: true,
                  connectionProxyUrl: pick.proxyUrl,
                  connectionNoProxy: noProxy,

                  strictProxy: proxyPool.strictProxy === true,
                  rotationUsed: true,
                };
              }
            }
          } catch (error) {
            console.warn(
              "[resolveConnectionProxyConfig] Rotation pick failed, falling back to bound pool:",
              error?.message
            );
          }
        }

        return {
          source: "pool",

          proxyPoolId,
          proxyPool,

          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          connectionNoProxy: noProxy,

          strictProxy: proxyPool.strictProxy === true,
        };
      }
    }

    /**
     * -----------------------------
     * Legacy Proxy Fallback
     * -----------------------------
     */
    if (
      legacy.connectionProxyEnabled &&
      legacy.connectionProxyUrl
    ) {
      return {
        source: "legacy",

        proxyPoolId: proxyPoolId || null,
        proxyPool: null,

        ...legacy,
      };
    }

    /**
     * -----------------------------
     * No Proxy Config
     * -----------------------------
     */
    return {
      source: "none",

      proxyPoolId: proxyPoolId || null,
      proxyPool: null,

      ...legacy,
    };
  } catch (error) {
    console.error(
      "[resolveConnectionProxyConfig] Failed to resolve proxy config:",
      error
    );

    return {
      source: "error",

      proxyPoolId: null,
      proxyPool: null,

      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",

      strictProxy: false,
    };
  }
}
