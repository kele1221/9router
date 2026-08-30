export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();
    // Warm up proxy rotation infra at boot. bootstrap.js's initializeApp only
    // runs when the dashboard layout renders — an API-only worker never fires
    // it — so this is the guaranteed startup hook for:
    //   - the pool health probe loop, and
    //   - Clash/mihomo controllers (lazy init in getClashController).
    // All no-ops while proxyRotation is disabled.
    try {
      const { getSettings, getProxyPools } = await import("@/lib/localDb");
      const settings = await getSettings();
      if (settings?.proxyRotation?.enabled) {
        const { getRotationManager } = await import("@/lib/network/proxyPoolManager");
        getRotationManager().startHealthProbe();
        const { getClashController } = await import("@/lib/network/clashController");
        const clashPools = (await getProxyPools({ isActive: true })).filter((p) => p.type === "clash");
        for (const pool of clashPools) getClashController(pool);
      }
    } catch (e) {
      console.warn("[ClashInit] warmup failed:", e?.message);
    }

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();
  }
}
