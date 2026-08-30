import { getProxyPools, getProxyPoolById, updateProxyPool } from "@/models";
import { getSettings } from "@/lib/localDb";
import { testProxyUrl } from "./proxyTest.js";

export const PROXY_ROTATION_DEFAULTS = {
  enabled: false,
  strategy: "weighted-random",
  rateLimitFreezeMs: 300000,
  networkFreezeMs: 30000,
  consecutiveFailureLimit: 3,
  maxRotationsPerRequest: 3,
  healthProbeIntervalMs: 300000,
  healthProbeTimeoutMs: 8000,
  healthProbeConcurrency: 8,
  candidateThresholdMs: 3000,
  recencyWindowMs: 86400000,
};

const PERSIST_DEBOUNCE_MS = 10000;

function normalizeProxyKey(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    return `${u.hostname}:${u.port || (u.protocol === "https:" ? 443 : 80)}`;
  } catch {
    return String(proxyUrl || "").trim();
  }
}

function emptyState(url, poolId) {
  return {
    url,
    poolId,
    status: "active",
    consecutiveFailures: 0,
    rateLimitedUntil: 0,
    networkFreezeUntil: 0,
    lastLatencyMs: null,
    lastCheckedAt: null,
    lastUsedAt: null,
  };
}

/**
 * In-process health-aware proxy pool scheduling + failure-driven rotation state.
 * State is keyed by normalized host:port; persisted to proxyPools.data.health
 * (flat field, survives restart). All methods fail-open: DB/network errors are
 * swallowed by callers where it matters.
 */
export class ProxyPoolManager {
  constructor() {
    this.state = new Map();
    this.dirtyPoolIds = new Set();
    this.persistTimer = null;
    this.lastSweepAt = 0;
    this.probeTimer = null;
  }

  async _settings() {
    const raw = await getSettings();
    return { ...PROXY_ROTATION_DEFAULTS, ...(raw?.proxyRotation || {}) };
  }

  _getState(url, poolId) {
    const key = normalizeProxyKey(url);
    let st = this.state.get(key);
    if (!st) {
      st = emptyState(url, poolId);
      this.state.set(key, st);
    }
    return st;
  }

  _seedFromPool(pool) {
    if (!pool?.proxyUrl || typeof pool.health !== "object" || !pool.health) return;
    const key = normalizeProxyKey(pool.proxyUrl);
    if (this.state.has(key)) return;
    const h = pool.health;
    this.state.set(key, {
      url: pool.proxyUrl,
      poolId: pool.id,
      status: h.status || "active",
      consecutiveFailures: Number(h.consecutiveFailures) || 0,
      rateLimitedUntil: Number(h.rateLimitedUntil) || 0,
      networkFreezeUntil: Number(h.networkFreezeUntil) || 0,
      lastLatencyMs: h.lastLatencyMs != null ? Number(h.lastLatencyMs) : null,
      lastCheckedAt: h.lastCheckedAt || null,
      lastUsedAt: h.lastUsedAt || null,
    });
  }

  async _loadPools(poolIds) {
    const active = await getProxyPools({ isActive: true });
    let pools = active;
    if (poolIds && poolIds.length > 0) {
      const wanted = new Set(poolIds);
      const groupIds = new Set(
        active.filter((p) => wanted.has(p.id) && p.groupId).map((p) => p.groupId)
      );
      pools = active.filter((p) => wanted.has(p.id) || (p.groupId && groupIds.has(p.groupId)));
    }
    for (const p of pools) this._seedFromPool(p);
    return pools;
  }

  _isFrozen(st, settings, now) {
    return (
      st.status === "disabled" ||
      st.rateLimitedUntil > now ||
      st.networkFreezeUntil > now
    );
  }

  _freezePenalty(st, now) {
    const thaw = Math.min(st.rateLimitedUntil || 0, st.networkFreezeUntil || 0);
    return Math.max(0, thaw - now);
  }

  /**
   * Pick a healthy proxy from the given pool ids (groupId-expanded).
   * Returns { poolId, proxyUrl } or null. Pinned url wins when still healthy.
   * All candidates frozen → returns the soonest-thawing one (caller budget
   * guarantees termination), never throws.
   */
  async pickProxy({ poolIds = null, excludeUrls = null, pinned = null, now = Date.now() } = {}) {
    const settings = await this._settings();
    const exclude = excludeUrls instanceof Set ? excludeUrls : new Set(excludeUrls || []);
    let pools = await this._loadPools(poolIds);
    pools = pools.filter((p) => p.isActive === true && p.proxyUrl && !exclude.has(p.proxyUrl));
    if (pools.length === 0) return null;

    if (pinned) {
      const p = pools.find((x) => x.proxyUrl === pinned);
      const st = p && this._getState(p.proxyUrl, p.id);
      if (p && st && !this._isFrozen(st, settings, now)) {
        return { poolId: p.id, proxyUrl: p.proxyUrl };
      }
    }

    const frozen = [];
    const healthy = [];
    for (const p of pools) {
      const st = this._getState(p.proxyUrl, p.id);
      if (st.status === "disabled") continue;
      (this._isFrozen(st, settings, now) ? frozen : healthy).push({ pool: p, state: st });
    }

    if (healthy.length === 0) {
      if (frozen.length === 0) return null;
      const pick = frozen.sort((a, b) => this._freezePenalty(a.state, now) - this._freezePenalty(b.state, now))[0];
      return { poolId: pick.pool.id, proxyUrl: pick.pool.proxyUrl };
    }

    const withLatency = healthy.filter((c) => c.state.lastLatencyMs != null);
    if (withLatency.length > 0) {
      const threshold = Number(settings.candidateThresholdMs) || 3000;
      const recencyWindow = Number(settings.recencyWindowMs) || 86400000;
      const weighted = withLatency.map((c) => {
        const latencyWeight = Math.max(0, (threshold - c.state.lastLatencyMs) / threshold);
        const usedRecently = c.state.lastUsedAt && now - c.state.lastUsedAt < recencyWindow;
        return { ...c, weight: latencyWeight * (usedRecently ? 0.3 : 1.0) };
      });
      const total = weighted.reduce((sum, c) => sum + c.weight, 0);
      if (total > 0) {
        let r = Math.random() * total;
        for (const c of weighted) {
          r -= c.weight;
          if (r <= 0) return { poolId: c.pool.id, proxyUrl: c.pool.proxyUrl };
        }
        const last = weighted[weighted.length - 1];
        return { poolId: last.pool.id, proxyUrl: last.pool.proxyUrl };
      }
      const best = withLatency.sort((a, b) => a.state.lastLatencyMs - b.state.lastLatencyMs)[0];
      return { poolId: best.pool.id, proxyUrl: best.pool.proxyUrl };
    }

    // Cold start: least recently used (nulls first, then oldest).
    const lru = healthy.sort((a, b) => (a.state.lastUsedAt || 0) - (b.state.lastUsedAt || 0))[0];
    return { poolId: lru.pool.id, proxyUrl: lru.pool.proxyUrl };
  }

  async markProxyUsed(url, now = Date.now()) {
    const st = this._getState(url, null);
    st.lastUsedAt = now;
    if (st.poolId) this._markDirty(st.poolId);
  }

  async markProxyFailed({ url, poolId, errorType, now = Date.now() } = {}) {
    if (!url) return;
    const settings = await this._settings();
    const st = this._getState(url, poolId || null);
    if (errorType === "rate_limit") {
      st.rateLimitedUntil = now + (Number(settings.rateLimitFreezeMs) || 300000);
    } else if (errorType === "network") {
      st.networkFreezeUntil = now + (Number(settings.networkFreezeMs) || 30000);
      st.consecutiveFailures = (st.consecutiveFailures || 0) + 1;
      if (st.consecutiveFailures >= (Number(settings.consecutiveFailureLimit) || 3)) {
        st.status = "disabled";
      }
    }
    if (st.poolId) this._markDirty(st.poolId);
  }

  async markProxySuccess(url, now = Date.now()) {
    if (!url) return;
    const st = this._getState(url, null);
    st.status = "active";
    st.consecutiveFailures = 0;
    st.rateLimitedUntil = 0;
    st.networkFreezeUntil = 0;
    st.lastUsedAt = now;
    if (st.poolId) this._markDirty(st.poolId);
  }

  async probeProxy(url, poolId = null) {
    const settings = await this._settings();
    const res = await testProxyUrl({ proxyUrl: url, timeoutMs: Number(settings.healthProbeTimeoutMs) || 8000 });
    const st = this._getState(url, poolId);
    st.lastCheckedAt = Date.now();
    st.lastLatencyMs = res.ok ? res.elapsedMs ?? null : null;
    if (!res.ok && res.elapsedMs == null) st.lastLatencyMs = null;
    return res;
  }

  async sweep() {
    const settings = await this._settings();
    const now = Date.now();
    if (settings.enabled === false || now - this.lastSweepAt < (Number(settings.healthProbeIntervalMs) || 300000)) {
      return;
    }
    this.lastSweepAt = now;
    const pools = (await this._loadPools(null)).filter((p) => p.proxyUrl);
    const concurrency = Number(settings.healthProbeConcurrency) || 8;
    let idx = 0;
    const workers = Array.from({ length: Math.min(concurrency, pools.length || 1) }, async () => {
      while (idx < pools.length) {
        const p = pools[idx++];
        try {
          await this.probeProxy(p.proxyUrl, p.id);
          if (p.id) this._markDirty(p.id);
        } catch {
          // probe failures are already reflected as ok:false — never throw
        }
      }
    });
    await Promise.all(workers);
    await this.persist();
  }

  _markDirty(poolId) {
    if (!poolId) return;
    this.dirtyPoolIds.add(poolId);
    this._schedulePersist();
  }

  _schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist().catch((e) => console.warn("[ProxyPoolManager] persist failed:", e?.message));
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref?.();
  }

  async persist() {
    const poolIds = [...this.dirtyPoolIds];
    if (poolIds.length === 0) return;
    this.dirtyPoolIds.clear();
    for (const poolId of poolIds) {
      try {
        const pool = await getProxyPoolById(poolId);
        if (!pool?.proxyUrl) continue;
        const st = this._getState(pool.proxyUrl, poolId);
        await updateProxyPool(poolId, {
          health: {
            status: st.status,
            consecutiveFailures: st.consecutiveFailures,
            rateLimitedUntil: st.rateLimitedUntil,
            networkFreezeUntil: st.networkFreezeUntil,
            lastLatencyMs: st.lastLatencyMs,
            lastCheckedAt: st.lastCheckedAt,
            lastUsedAt: st.lastUsedAt,
          },
        });
      } catch (e) {
        console.warn(`[ProxyPoolManager] persist pool ${poolId} failed:`, e?.message);
      }
    }
  }

  /** Background probe loop; no-ops while proxyRotation is disabled. */
  startHealthProbe() {
    if (this.probeTimer) return this.probeTimer;
    this.probeTimer = setInterval(() => {
      this.sweep().catch(() => {});
    }, 60000);
    this.probeTimer.unref?.();
    return this.probeTimer;
  }
}

let rotationManager = null;
export function getRotationManager() {
  if (!rotationManager) rotationManager = new ProxyPoolManager();
  return rotationManager;
}
