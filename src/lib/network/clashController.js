import fs from "fs";
import http from "http";
import * as log from "../../sse/utils/logger.js";

/**
 * Port of opencode-proxy/src/clash.mjs (ClashController) for 9router.
 * Adjustments:
 * - Config comes from proxyPools.data.clash (per pool), not proxy.config.json.
 * - Verge enhancement-profile sync (js-yaml) is NOT enabled: reconcileAiProvider
 *   / syncNodesToAiProvider are stubs returning { ok:false }. Controller API,
 *   socket/TCP dual channel + recovery, candidate latency testing, weighted
 *   random selection, rate-limit freeze, high-latency tracking, auto-switch
 *   and pool reconciliation plumbing are preserved.
 */

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) });
        } catch {
          resolve({ status: res.statusCode, data: null });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function socketRequest(socketPath, method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath,
      method,
      path,
      headers: { "Content-Type": "application/json", Host: "localhost", ...headers },
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) });
        } catch {
          resolve({ status: res.statusCode, data: null });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("socket timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

const FILTERED_NODES = ["DIRECT", "REJECT", "PASS", "剩余流量", "套餐到期", "已用流量", "到期时间"];
const FALLBACK_SOCKET = "/tmp/verge/verge-mihomo.sock";
const FALLBACK_URL = "http://127.0.0.1:9090";

function setsEqual(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set)) return false;
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export class ClashController {
  constructor(config) {
    this.currentNode = "";
    this.currentAiNode = "";
    this.lastSwitch = 0;
    this.lastAiSwitch = 0;
    this.ready = false;
    this.aiFailedUntil = new Map();
    this._disabledNodes = new Set();
    this._useSocket = null; // null = detect, true = socket, false = tcp
    this._lastSocketError = null;
    this._recoveryScheduled = false;
    this._lastFailedAiNode = null;
    this._lastSyncedNodes = new Set();
    this._reconciling = false;
    this._lastSyncAt = 0;
    this._autoSyncEnabled = true;
    this._autoSyncIntervalMs = 300000;
    this._pollTimer = null;
    this._highLatencyCount = new Map();
    this._nodeLastAiUsed = new Map();
    this._nodeRateLimitedUntil = new Map();
    this.applyConfig(config);
  }

  _now() {
    return Date.now();
  }

  applyConfig(config) {
    const previousSocket = this.unixSocket;
    const previousUrl = this.controllerUrl;

    this.enabled = config?.enabled !== false;
    this.unixSocket = config?.controllerUnixSocket || FALLBACK_SOCKET;
    this.controllerUrl = config?.controllerUrl || FALLBACK_URL;
    this.secret = config?.secret || "";
    this.selectorGroup = config?.selectorGroup || "节点选择";
    this.aiSelectorGroup = config?.aiSelectorGroup || "AI-Provider";
    this.aiNodesSourceGroup = config?.aiNodesSourceGroup || config?.selectorGroup || "节点选择";
    this.proxyMode = config?.proxyMode === "system" ? "system" : "ai";
    this.preferredRegions = config?.preferredRegions || ["日本", "新加坡", "香港", "美国"];
    this.cooldownMs = config?.cooldownMs || 3000;
    this.aiFailedNodeCooldownMs = config?.aiFailedNodeCooldownMs || 600000;
    this.aiDelayTestUrl = config?.aiDelayTestUrl || "https://www.gstatic.com/generate_204";
    this.aiDelayTestTimeoutMs = config?.aiDelayTestTimeoutMs || 5000;
    this.aiHighLatencyThresholdMs = config?.aiHighLatencyThresholdMs || 7000;
    this.aiConsecutiveHighLatencyLimit = config?.aiConsecutiveHighLatencyLimit || 3;
    this.aiCandidateThresholdMs = config?.aiCandidateThresholdMs || 3000;
    this.aiRateLimitFreezeMs = config?.aiRateLimitFreezeMs || 300000;
    this.autoSwitch = this.proxyMode === "system" ? false : config?.autoSwitch !== false;
    this.mixedPort = config?.mixedPort || 7890;
    // Verge profile sync stays disabled by default (would need js-yaml).
    this._syncEnabled = config?.syncEnabled === true;
    this._autoSyncEnabled = config?.autoSyncEnabled !== false;
    this._autoSyncIntervalMs = config?.autoSyncIntervalMs || 300000;

    if (config?.disabledAiNodes && Array.isArray(config.disabledAiNodes)) {
      this._disabledNodes = new Set(config.disabledAiNodes);
    }

    if (previousSocket !== this.unixSocket || previousUrl !== this.controllerUrl) {
      this._useSocket = null;
      this._lastSocketError = null;
      this._recoveryScheduled = false;
    }
  }

  get _headers() {
    const h = { "Content-Type": "application/json" };
    if (this.secret) h.Authorization = `Bearer ${this.secret}`;
    return h;
  }

  async _request(method, path, body) {
    // ── Prefer Unix socket ──
    if (this._useSocket !== false) {
      if (fs.existsSync(this.unixSocket)) {
        try {
          this._useSocket = true;
          return await socketRequest(this.unixSocket, method, path, this._headers, body);
        } catch (socketErr) {
          if (this._lastSocketError !== socketErr.message) {
            log.warn("CLASH", `Socket request failed, trying TCP fallback: ${socketErr.message}`);
            this._lastSocketError = socketErr.message;
          }
          // Don't permanently degrade — fall through to TCP for this request
        }
      } else {
        this._useSocket = false;
      }
    }

    // ── TCP fallback ──
    try {
      const url = new URL(path, this.controllerUrl);
      const result = await httpRequest({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: this._headers,
        timeout: 5000,
      }, body);

      if (result.status === 404 || (result.data && result.data.error)) {
        this._scheduleSocketRecovery();
      }

      return result;
    } catch (tcpErr) {
      this._scheduleSocketRecovery();
      throw tcpErr;
    }
  }

  _scheduleSocketRecovery() {
    if (this._recoveryScheduled) return;
    this._recoveryScheduled = true;

    setTimeout(() => {
      this._recoveryScheduled = false;
      this._probeSocketRecovery();
    }, 30000).unref();
  }

  async _probeSocketRecovery() {
    if (!fs.existsSync(this.unixSocket)) return;
    try {
      const result = await socketRequest(this.unixSocket, "GET", "/configs", this._headers);
      if (result.status === 200 && result.data) {
        log.info("CLASH", "Socket recovered! Switching back to Unix socket mode");
        this._useSocket = true;
        this._lastSocketError = null;
      }
    } catch {
      // Socket still unavailable — will retry on next failure
    }
  }

  async init() {
    if (!this.enabled) {
      log.info("CLASH", "Disabled by config");
      return;
    }
    try {
      const configs = await this._request("GET", "/configs");
      if (configs.data) {
        this.ready = true;
        log.info("CLASH", `Connected${this._useSocket ? " via Unix socket" : " via TCP"}`);
        const group = await this.getSelectorGroup();
        if (group?.now) {
          this.currentNode = group.now;
          log.info("CLASH", `Current node: ${this.currentNode}`);
        }
        const aiGroup = await this.getAiSelectorGroup();
        if (aiGroup?.now) {
          this.currentAiNode = aiGroup.now;
          log.info("CLASH", `Current AI node: ${this.currentAiNode}`);
        }
        const modeResult = await this.setProxyMode(this.proxyMode);
        if (!modeResult.success) {
          log.warn("CLASH", `Proxy mode apply failed: ${modeResult.error}`);
        }
      }
    } catch (e) {
      log.warn("CLASH", `Not available: ${e.message}`);
    }
    this.startAutoSync();
  }

  stop() {
    this.stopAutoSync();
  }

  async getProxies() {
    if (!this.ready) return null;
    const resp = await this._request("GET", "/proxies");
    return resp.data;
  }

  _normalizeGroup(name, group) {
    if (!group || !Array.isArray(group.all)) return null;

    const candidates = group.all.filter((n) => !FILTERED_NODES.some((f) => n.includes(f)));

    return {
      name,
      type: group.type,
      now: group.now || "",
      all: group.all || [],
      candidates,
    };
  }

  _isLeafProxyCandidate(name, proxies) {
    if (!name || name === this.selectorGroup) return false;
    const proxy = proxies?.[name];
    return !Array.isArray(proxy?.all);
  }

  async getSelectorGroup() {
    const proxies = await this.getProxies();
    if (!proxies?.proxies) return null;

    let group = proxies.proxies[this.selectorGroup];
    if (!group) {
      for (const [name, p] of Object.entries(proxies.proxies)) {
        if (p.type === "Selector") {
          group = p;
          this.selectorGroup = name;
          break;
        }
      }
    }
    if (!group || group.type !== "Selector") return null;

    return this._normalizeGroup(this.selectorGroup, group);
  }

  async getAiSelectorGroup() {
    const proxies = await this.getProxies();
    if (!proxies?.proxies) return null;

    const group = this._normalizeGroup(this.aiSelectorGroup, proxies.proxies[this.aiSelectorGroup]);
    if (!group) return null;
    group.candidates = group.candidates.filter((n) => this._isLeafProxyCandidate(n, proxies.proxies));
    if (this._disabledNodes.size > 0) {
      group.all = group.all.filter((n) => !this._disabledNodes.has(n));
      group.candidates = group.candidates.filter((n) => !this._disabledNodes.has(n));
      if (group.now && this._disabledNodes.has(group.now)) {
        group.now = "";
      }
    }
    return group;
  }

  async getUsableNodePool() {
    const proxies = await this.getProxies();
    if (!proxies?.proxies) return null;

    const group = proxies.proxies[this.aiNodesSourceGroup];
    if (!group || !Array.isArray(group.all)) return null;

    const leafNodes = group.all.filter(
      (n) =>
        !FILTERED_NODES.some((f) => n.includes(f)) &&
        n !== this.aiNodesSourceGroup &&
        !proxies.proxies[n]?.all
    );

    return {
      name: this.aiNodesSourceGroup,
      type: group.type,
      now: group.now || "",
      all: leafNodes,
    };
  }

  async switchGroupNode(group, nodeName, { ai = false, allowGroupSelection = false } = {}) {
    if (!this.ready) return { success: false, error: "Clash not ready" };
    if (!group) return { success: false, error: "Selector group not found" };

    const validTargets = allowGroupSelection ? group.all : group.candidates;
    if (!validTargets.includes(nodeName)) {
      return { success: false, error: `Node "${nodeName}" not in candidates` };
    }

    try {
      const path = `/proxies/${encodeURIComponent(group.name)}`;
      const resp = await this._request("PUT", path, JSON.stringify({ name: nodeName }));
      if (resp.status === 204 || resp.status === 200) {
        if (ai) {
          this.currentAiNode = nodeName;
          this.lastAiSwitch = this._now();
          this._nodeLastAiUsed.set(nodeName, this._now());
          log.info("CLASH", `Switched AI group ${group.name} to ${nodeName}`);
        } else {
          this.currentNode = nodeName;
          this.lastSwitch = this._now();
          log.info("CLASH", `Switched to ${nodeName}`);
        }
        return { success: true, node: nodeName };
      }
      return { success: false, error: `Switch returned ${resp.status}` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async switchNode(nodeName) {
    const group = await this.getSelectorGroup();
    if (!group) return { success: false, error: "Selector group not found" };
    return this.switchGroupNode(group, nodeName);
  }

  async switchAiNode(nodeName) {
    const group = await this.getAiSelectorGroup();
    if (!group) return { success: false, error: "AI selector group not found" };
    return this.switchGroupNode(group, nodeName, { ai: true });
  }

  async switchAiToSystemSelector() {
    if (!this.ready) return { success: false, error: "Clash not ready" };

    const group = await this.getAiSelectorGroup();
    if (!group) return { success: false, error: "AI selector group not found" };

    if (this.aiSelectorGroup === this.selectorGroup) {
      this.proxyMode = "system";
      this.autoSwitch = false;
      this.currentAiNode = this.currentNode || group.now || "";
      return { success: true, node: this.currentAiNode, selected: this.selectorGroup };
    }

    if (!group.all.includes(this.selectorGroup)) {
      return {
        success: false,
        error: `AI selector group "${this.aiSelectorGroup}" does not include global selector "${this.selectorGroup}"`,
      };
    }

    const result = await this.switchGroupNode(group, this.selectorGroup, { ai: true, allowGroupSelection: true });
    if (result.success) {
      this.proxyMode = "system";
      this.autoSwitch = false;
    }
    return { ...result, selected: this.selectorGroup };
  }

  async switchAiToDedicatedNode() {
    if (!this.ready) return { success: false, error: "Clash not ready" };

    const group = await this.getAiSelectorGroup();
    if (!group) return { success: false, error: "AI selector group not found" };

    if (group.now && group.candidates.includes(group.now)) {
      this.proxyMode = "ai";
      this.currentAiNode = group.now;
      return { success: true, node: group.now, switched: false };
    }

    const nodeName = group.candidates[0];
    if (!nodeName) return { success: false, error: "No AI node candidates available" };

    const result = await this.switchAiNode(nodeName);
    if (result.success) {
      this.proxyMode = "ai";
      this.autoSwitch = true; // Bug1 fix: restore autoSwitch so future failovers work
    }
    return result;
  }

  async setProxyMode(mode) {
    if (mode === "system") return this.switchAiToSystemSelector();
    if (mode === "ai") return this.switchAiToDedicatedNode();
    return { success: false, error: `Unknown proxy mode: ${mode}` };
  }

  async findNextCandidate(currentNode) {
    const group = await this.getSelectorGroup();
    if (!group) return null;

    for (const region of this.preferredRegions) {
      const match = group.candidates.find((n) => n !== currentNode && n.includes(region));
      if (match) return match;
    }

    return group.candidates.find((n) => n !== currentNode) || null;
  }

  _markAiNodeFailed(nodeName) {
    if (!nodeName) return;
    this.aiFailedUntil.set(nodeName, this._now() + this.aiFailedNodeCooldownMs);
  }

  _isAiNodeCooling(nodeName) {
    const until = this.aiFailedUntil.get(nodeName);
    if (!until) return false;
    if (until <= this._now()) {
      this.aiFailedUntil.delete(nodeName);
      return false;
    }
    return true;
  }

  // ── Rate-limit freeze ─────────────────────────────────────────────

  markNodeRateLimited(nodeName) {
    if (!nodeName) return;
    this._nodeRateLimitedUntil.set(nodeName, this._now() + this.aiRateLimitFreezeMs);
    log.info("CLASH", `Node rate-limit frozen for ${this.aiRateLimitFreezeMs / 1000}s: ${nodeName}`);
  }

  _isNodeRateLimited(nodeName) {
    const until = this._nodeRateLimitedUntil.get(nodeName);
    if (!until) return false;
    if (until <= this._now()) {
      this._nodeRateLimitedUntil.delete(nodeName);
      return false;
    }
    return true;
  }

  _wasNodeUsedInLast24h(nodeName) {
    const ts = this._nodeLastAiUsed.get(nodeName);
    if (!ts) return false;
    return this._now() - ts < 86400000;
  }

  getRateLimitedNodes() {
    const now = this._now();
    const nodes = [];
    for (const [name, until] of this._nodeRateLimitedUntil) {
      if (until > now) nodes.push(name);
      else this._nodeRateLimitedUntil.delete(name);
    }
    return nodes;
  }

  /**
   * Track consecutive high-latency responses for a node.
   * Returns { highLatency, count }; at aiConsecutiveHighLatencyLimit the
   * counter resets and highLatency=true signals the caller to auto-switch.
   */
  recordNodeLatency(nodeName, latencyMs) {
    if (!nodeName || !this.ready || !this.autoSwitch) {
      return { highLatency: false, count: 0 };
    }
    const current = this._highLatencyCount.get(nodeName) || 0;

    if (latencyMs < this.aiHighLatencyThresholdMs) {
      if (current > 0) {
        this._highLatencyCount.delete(nodeName);
      }
      return { highLatency: false, count: 0 };
    }

    const newCount = current + 1;
    this._highLatencyCount.set(nodeName, newCount);

    if (newCount >= this.aiConsecutiveHighLatencyLimit) {
      this._highLatencyCount.delete(nodeName);
      return { highLatency: true, count: newCount };
    }

    return { highLatency: false, count: newCount };
  }

  getHighLatencyCounts() {
    return Object.fromEntries(this._highLatencyCount);
  }

  async testNodeDelay(nodeName) {
    const path = `/proxies/${encodeURIComponent(nodeName)}/delay?url=${encodeURIComponent(this.aiDelayTestUrl)}&timeout=${encodeURIComponent(String(this.aiDelayTestTimeoutMs))}`;
    const resp = await this._request("GET", path);
    const delay = Number(resp.data?.delay);
    if ((resp.status === 200 || resp.status === 204) && Number.isFinite(delay) && delay >= 0) {
      return { node: nodeName, delay };
    }
    return null;
  }

  async findAiCandidate(currentNode, group) {
    const aiGroup = group || (await this.getAiSelectorGroup());
    if (!aiGroup) return null;

    const threshold = this.aiCandidateThresholdMs;

    const candidates = aiGroup.candidates
      .map((node, index) => ({ node, index }))
      .filter(({ node }) =>
        node !== currentNode && !this._isAiNodeCooling(node) && !this._isNodeRateLimited(node)
      );

    if (candidates.length === 0) return null;

    const tested = (await Promise.all(
      candidates.map(async ({ node, index }) => {
        try {
          const result = await this.testNodeDelay(node);
          return result ? { ...result, index } : null;
        } catch {
          return null;
        }
      })
    )).filter(Boolean);

    if (tested.length === 0) return null;

    const qualified = tested.filter((t) => t.delay < threshold);

    if (qualified.length === 0) {
      return tested.sort((a, b) => a.delay - b.delay || a.index - b.index)[0];
    }

    const weighted = qualified.map((t) => {
      const latencyWeight = Math.max(0, (threshold - t.delay) / threshold);
      const recencyPenalty = this._wasNodeUsedInLast24h(t.node) ? 0.3 : 1.0;
      return { ...t, weight: latencyWeight * recencyPenalty };
    });

    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
    if (totalWeight <= 0) {
      return tested.sort((a, b) => a.delay - b.delay || a.index - b.index)[0];
    }

    let random = Math.random() * totalWeight;
    for (const candidate of weighted) {
      random -= candidate.weight;
      if (random <= 0) return candidate;
    }

    return weighted[weighted.length - 1];
  }

  async autoSwitchForAi(currentNode) {
    if (this._now() - this.lastAiSwitch < this.cooldownMs) {
      return { switched: false, reason: "cooldown" };
    }
    if (!this.ready) return { switched: false, reason: "clash not ready" };

    const group = await this.getAiSelectorGroup();
    if (!group) return { switched: false, reason: "ai group not found" };

    const failedNode = group.now || currentNode || "";
    this._markAiNodeFailed(failedNode);
    this._lastFailedAiNode = failedNode;

    const next = await this.findAiCandidate(failedNode, group);
    if (!next) {
      log.info("CLASH", `AI group no candidates after ${failedNode} -> falling back to system selector`);
      const systemResult = await this.switchAiToSystemSelector();
      if (systemResult.success) {
        const selectorGroup = await this.getSelectorGroup();
        const actualNode = selectorGroup?.now || this.selectorGroup;
        return {
          switched: true,
          fromNode: failedNode,
          toNode: actualNode,
          delay: null,
          reason: "ai failover to system selector",
          proxyMode: "system",
          ...systemResult,
        };
      }
      return {
        switched: false,
        fromNode: failedNode,
        reason: `no ai candidate and system fallback failed: ${systemResult.error || ""}`,
      };
    }

    const result = await this.switchAiNode(next.node);
    return {
      switched: result.success,
      fromNode: failedNode,
      toNode: next.node,
      delay: next.delay,
      reason: "ai auto failover",
      ...result,
    };
  }

  async autoSwitch(currentNode) {
    if (this._now() - this.lastSwitch < this.cooldownMs) {
      return { switched: false, reason: "cooldown" };
    }

    const next = await this.findNextCandidate(currentNode);
    if (!next) return { switched: false, reason: "no candidate" };

    const result = await this.switchNode(next);
    return {
      switched: result.success,
      fromNode: currentNode,
      toNode: next,
      reason: "auto failover",
      ...result,
    };
  }

  getStatus() {
    return {
      enabled: this.enabled,
      autoSwitch: this.autoSwitch,
      ready: this.ready,
      currentNode: this.currentNode,
      currentAiNode: this.currentAiNode,
      selectorGroup: this.selectorGroup,
      aiSelectorGroup: this.aiSelectorGroup,
      aiNodesSourceGroup: this.aiNodesSourceGroup,
      proxyMode: this.proxyMode,
      lastSwitch: this.lastSwitch,
      lastAiSwitch: this.lastAiSwitch,
      aiFailedNodeCooldownMs: this.aiFailedNodeCooldownMs,
      aiDelayTestUrl: this.aiDelayTestUrl,
      aiDelayTestTimeoutMs: this.aiDelayTestTimeoutMs,
      aiHighLatencyThresholdMs: this.aiHighLatencyThresholdMs,
      aiConsecutiveHighLatencyLimit: this.aiConsecutiveHighLatencyLimit,
      aiCandidateThresholdMs: this.aiCandidateThresholdMs,
      aiRateLimitFreezeMs: this.aiRateLimitFreezeMs,
      rateLimitedNodes: this.getRateLimitedNodes(),
    };
  }

  // ── Pool reconciliation (Verge profile sync disabled by default) ──

  startAutoSync() {
    if (!this.enabled || !this._autoSyncEnabled) return;
    if (this._pollTimer) return;

    this._pollTimer = setInterval(() => this._checkAndReconcile(), this._autoSyncIntervalMs);
    setTimeout(() => this._checkAndReconcile(), 5000);
    log.info("AUTO SYNC", `Started (interval: ${this._autoSyncIntervalMs}ms)`);
  }

  stopAutoSync() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
      log.info("AUTO SYNC", "Stopped");
    }
  }

  async _checkAndReconcile() {
    if (this._reconciling) return;
    if (!this.ready) return;

    try {
      const pool = await this.getUsableNodePool();
      if (!pool?.all?.length) return;

      const currentNodes = new Set(pool.all);
      if (setsEqual(currentNodes, this._lastSyncedNodes)) return;

      this._lastSyncedNodes = currentNodes;
      this._lastSyncAt = Date.now();

      if (!this._syncEnabled) return; // profile sync off — track snapshot only

      this._reconciling = true;
      try {
        const result = await this.reconcileAiProvider();
        if (result.ok && result.reconciled) {
          log.info("AUTO SYNC", `Reconciled: added ${result.added.length} removed ${result.removed.length}`);
        } else if (!result.ok) {
          log.warn("AUTO SYNC", `Reconcile failed: ${result.error}`);
        }
      } finally {
        this._reconciling = false;
      }
    } catch (e) {
      log.warn("AUTO SYNC", `Check/reconcile error: ${e.message}`);
    }
  }

  async reconcileAiProvider() {
    return { ok: false, error: "profile sync not enabled" };
  }

  async syncNodesToAiProvider() {
    return { ok: false, error: "not enabled" };
  }

  // ── Node Enable/Disable ──────────────────────────────────────────

  enableNode(name) {
    this._disabledNodes.delete(name);
  }

  disableNode(name) {
    this._disabledNodes.add(name);
  }

  isNodeEnabled(name) {
    return !this._disabledNodes.has(name);
  }

  getDisabledNodes() {
    return Array.from(this._disabledNodes);
  }

  getDisabledAiNodes() {
    return Array.from(this._disabledNodes);
  }
}

/**
 * Module-level controller cache keyed by endpoint so all requests share one
 * controller per clash pool endpoint.
 */
const controllers = new Map();

export function getClashController(pool) {
  const clash = pool?.clash || {};
  const url = clash.controllerUrl || FALLBACK_URL;
  const sock = clash.controllerUnixSocket || FALLBACK_SOCKET;
  const key = `${url}|${sock}`;
  let controller = controllers.get(key);
  if (!controller) {
    controller = new ClashController({ ...clash, mixedPort: clash.mixedPort || pool?.mixedPort });
    controllers.set(key, controller);
  }
  // Lazy connect: without init(), ready stays false and clashRotate bails with
  // "clash-not-ready" forever. init() is guarded internally (enabled check +
  // startAutoSync dedup) so a second call after a reconnect is harmless.
  if (!controller._initStarted) {
    controller._initStarted = true;
    controller.init().catch(() => {});
  }
  return controller;
}

export function resetClashControllersForTests() {
  for (const c of controllers.values()) c.stop();
  controllers.clear();
}

/**
 * Failure hook entry for clash pools (called by tryRotateProxy): freeze the
 * current AI node on rate-limit, then auto-switch. Fail-open: never throws.
 */
export async function clashRotate({ credentials, status, error, kind } = {}) {
  try {
    const { getProxyPoolById } = await import("@/models");
    const pool = await getProxyPoolById(credentials?.providerSpecificData?.connectionProxyPoolId);
    const controller = getClashController(pool);
    if (!controller.ready) return { success: false, reason: "clash-not-ready" };
    if (kind === "rate_limit") {
      controller.markNodeRateLimited(controller.currentAiNode);
    }
    const result = await controller.autoSwitchForAi(controller.currentAiNode);
    if (result.switched) return { success: true, reason: result.reason, result };
    return { success: false, reason: result.reason || "no-switch" };
  } catch (e) {
    return { success: false, reason: e?.message || "error" };
  }
}
