"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Input, Modal, ConfirmModal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const DEFAULT_MARKER = "";
const DEFAULT_RULE = { text: "", status: "", cooldownMs: null, backoff: false };

function formatCooldown(ms) {
  if (!ms && ms !== 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function parseRuleDisplay(rule) {
  if (rule.text) return `text contains "${rule.text}"`;
  if (rule.status) return `status == ${rule.status}`;
  return "unknown";
}

function parseRuleEffect(rule) {
  if (rule.backoff) return "exponential backoff";
  if (rule.cooldownMs) return `cooldown ${formatCooldown(rule.cooldownMs)}`;
  return "no cooldown";
}

export default function ErrorRulesPage() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState("template");

  // Marker editor
  const [markers, setMarkers] = useState([]);
  const [newMarker, setNewMarker] = useState("");
  const [editingMarkerIdx, setEditingMarkerIdx] = useState(null);
  const [editMarkerValue, setEditMarkerValue] = useState("");

  // Rule editor
  const [rules, setRules] = useState([]);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRuleIdx, setEditingRuleIdx] = useState(null);
  const [ruleForm, setRuleForm] = useState({ ...DEFAULT_RULE });

  // Bulk restore confirmation
  const [confirmRestore, setConfirmRestore] = useState(false);

  const notify = useNotificationStore();

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/fork/error-rules", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setConfig(data.config);
      setSource(data.source);
      setMarkers(data.config.rateLimitMarkers?.slice() || []);
      setRules(data.config.errorRules?.map((r) => ({ ...r })) || []);
    } catch (e) {
      setError(`加载失败：${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // ── Marker operations ──

  function addMarker() {
    const trimmed = newMarker.trim().toLowerCase();
    if (!trimmed || markers.includes(trimmed)) return;
    setMarkers([...markers, trimmed]);
    setNewMarker("");
  }

  function startEditMarker(idx) {
    setEditingMarkerIdx(idx);
    setEditMarkerValue(markers[idx]);
  }

  function saveMarker(idx) {
    const trimmed = editMarkerValue.trim().toLowerCase();
    if (!trimmed || (markers.includes(trimmed) && markers[idx] !== trimmed)) return;
    const next = markers.slice();
    next[idx] = trimmed;
    setMarkers(next);
    setEditingMarkerIdx(null);
  }

  function removeMarker(idx) {
    setMarkers(markers.filter((_, i) => i !== idx));
    if (editingMarkerIdx === idx) setEditingMarkerIdx(null);
  }

  // ── Rule operations ──

  function openNewRule() {
    setEditingRuleIdx(null);
    setRuleForm({ ...DEFAULT_RULE });
    setShowRuleModal(true);
  }

  function openEditRule(idx) {
    setEditingRuleIdx(idx);
    const rule = rules[idx];
    setRuleForm({
      text: rule.text || "",
      status: rule.status ? String(rule.status) : "",
      cooldownMs: rule.cooldownMs ?? null,
      backoff: rule.backoff || false,
    });
    setShowRuleModal(true);
  }

  function saveRule() {
    const entry = {};
    const text = ruleForm.text.trim();
    const status = ruleForm.status ? parseInt(ruleForm.status, 10) : null;

    if (text) entry.text = text;
    if (status && !Number.isNaN(status)) entry.status = status;
    if (!text && !status) return; // at least one of text/status required

    if (ruleForm.backoff) {
      entry.backoff = true;
    } else if (ruleForm.cooldownMs != null && ruleForm.cooldownMs >= 0) {
      entry.cooldownMs = ruleForm.cooldownMs;
    }

    const next = rules.slice();
    if (editingRuleIdx != null) {
      next[editingRuleIdx] = entry;
    } else {
      next.push(entry);
    }
    setRules(next);
    setShowRuleModal(false);
  }

  function removeRule(idx) {
    setRules(rules.filter((_, i) => i !== idx));
  }

  function moveRule(fromIdx, direction) {
    const toIdx = fromIdx + direction;
    if (toIdx < 0 || toIdx >= rules.length) return;
    const next = rules.slice();
    [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
    setRules(next);
  }

  // ── Save ──

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...config,
        schemaVersion: config?.schemaVersion || 1,
        rateLimitMarkers: markers,
        errorRules: rules,
      };
      delete payload._localConfigPath;

      const res = await fetch("/api/fork/error-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setConfig(data.config);
      setSource(data.source);
      notify?.success?.("规则已保存并热加载");
    } catch (e) {
      setError(`保存失败：${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    setReloading(true);
    setError("");
    try {
      const res = await fetch("/api/fork/error-rules/reload", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setConfig(data.config);
      setSource(data.source);
      setMarkers(data.config.rateLimitMarkers?.slice() || []);
      setRules(data.config.errorRules?.map((r) => ({ ...r })) || []);
      notify?.success?.("已从磁盘重新加载");
    } catch (e) {
      setError(`重载失败：${e.message}`);
    } finally {
      setReloading(false);
    }
  }

  async function handleRestoreDefault() {
    try {
      const res = await fetch("/api/fork/error-rules/reload", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // If source is still "local", the local file exists — let user delete it manually
      if (data.source === "template") {
        setConfig(data.config);
        setSource(data.source);
        setMarkers(data.config.rateLimitMarkers?.slice() || []);
        setRules(data.config.errorRules?.map((r) => ({ ...r })) || []);
        notify?.success?.("已恢复为默认配置");
      } else {
        notify?.info?.("本地配置文件仍存在，需手动删除后重载");
      }
    } catch (e) {
      setError(`恢复失败：${e.message}`);
    }
    setConfirmRestore(false);
  }

  const hasChanges = (() => {
    if (!config) return false;
    const origMarkers = config.rateLimitMarkers || [];
    const origRules = config.errorRules || [];
    if (markers.length !== origMarkers.length) return true;
    if (!markers.every((m, i) => m === origMarkers[i])) return true;
    if (rules.length !== origRules.length) return true;
    return !rules.every((r, i) => {
      const orig = origRules[i];
      return r.text === orig.text
        && r.status === orig.status
        && r.cooldownMs === orig.cooldownMs
        && !!r.backoff === !!orig.backoff;
    });
  })();

  if (loading && !config) {
    return <div className="flex flex-col gap-4"><CardSkeleton /><CardSkeleton /></div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">错误规则</h1>
          <p className="mt-1 text-sm text-text-muted">
            运行时错误分类、熔断和速率限制标记 —— 修改即时生效，无需发布代码
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {source === "local" && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmRestore(true)}>恢复默认</Button>
          )}
          <Button variant="secondary" size="sm" icon="refresh" loading={reloading} onClick={handleReload}>重载</Button>
          <Button variant="primary" size="sm" icon="save" loading={saving} disabled={!hasChanges} onClick={handleSave}>
            保存
          </Button>
        </div>
      </div>

      {error && <Card className="border-red-500/30 text-sm text-red-600">{error}</Card>}

      {!hasChanges && source === "local" && (
        <Card className="border-blue-500/20 bg-blue-500/5 text-sm text-text-muted">
          规则已保存并生效。直接编辑下方规则后再次保存即可更新。
        </Card>
      )}

      {/* Config source */}
      <div className="flex items-center gap-3 rounded-[14px] border border-border-subtle bg-surface px-4 py-3">
        <span className="text-sm text-text-muted">配置来源</span>
        <Badge variant={source === "local" ? "success" : "default"} size="sm">
          {source === "local" ? `本地覆盖 (${config?._localConfigPath || ""})` : "内置默认"}
        </Badge>
        {hasChanges && <Badge variant="warning" size="sm" dot>未保存</Badge>}
      </div>

      {/* Rate Limit Markers */}
      <Card title="速率限制标记" subtitle="上游返回 400 时，如果 error.code 或 error.type 匹配以下任一标记，则归一化为 429" icon="flag">
        <div className="mb-3 flex flex-wrap gap-2">
          {markers.map((marker, idx) => (
            <div key={`${marker}-${idx}`} className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg px-3 py-1.5 text-sm">
              {editingMarkerIdx === idx ? (
                <input
                  className="w-40 bg-transparent text-sm outline-none"
                  type="text"
                  value={editMarkerValue}
                  onChange={(e) => setEditMarkerValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveMarker(idx); if (e.key === "Escape") setEditingMarkerIdx(null); }}
                  autoFocus
                />
              ) : (
                <code className="text-primary">{marker}</code>
              )}
              <button className="text-text-muted hover:text-text-main" onClick={() => startEditMarker(idx)} title="编辑">
                <span className="material-symbols-outlined text-sm">edit</span>
              </button>
              <button className="text-text-muted hover:text-red-500" onClick={() => removeMarker(idx)} title="删除">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="新标记名称，如 rate_limited"
            value={newMarker}
            onChange={(e) => setNewMarker(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addMarker(); }}
            className="max-w-sm"
          />
          <Button variant="secondary" size="sm" icon="add" onClick={addMarker} disabled={!newMarker.trim()}>添加</Button>
        </div>
      </Card>

      {/* Error Rules */}
      <Card title="错误分类规则" subtitle="从上到下匹配（文本规则优先于状态规则）。修改顺序影响分类结果" icon="list_alt" action={
        <Button variant="secondary" size="sm" icon="add" onClick={openNewRule}>新增规则</Button>
      }>
        {rules.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-muted">暂无规则</div>
        ) : (
          <div className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {rules.map((rule, idx) => (
              <div key={idx} className="flex items-center gap-3 p-3 hover:bg-surface-2/50">
                <div className="flex flex-col gap-0.5">
                  <button className="text-text-muted hover:text-text-main disabled:opacity-20" disabled={idx === 0} onClick={() => moveRule(idx, -1)} title="上移">
                    <span className="material-symbols-outlined text-base">arrow_upward</span>
                  </button>
                  <button className="text-text-muted hover:text-text-main disabled:opacity-20" disabled={idx === rules.length - 1} onClick={() => moveRule(idx, 1)} title="下移">
                    <span className="material-symbols-outlined text-base">arrow_downward</span>
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-main">{parseRuleDisplay(rule)}</p>
                  <p className="text-xs text-text-muted">→ {parseRuleEffect(rule)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEditRule(idx)}>编辑</Button>
                  <button className="rounded p-1 text-text-muted hover:text-red-500" onClick={() => removeRule(idx)} title="删除">
                    <span className="material-symbols-outlined text-base">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Backoff Config */}
      <Card title="退避参数" subtitle="指数退避和冷却上限" icon="tune">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex justify-between rounded-[10px] bg-bg px-4 py-3">
            <span className="text-text-muted">base</span>
            <code className="text-text-main">{config?.backoffConfig?.base || 2000}ms</code>
          </div>
          <div className="flex justify-between rounded-[10px] bg-bg px-4 py-3">
            <span className="text-text-muted">max</span>
            <code className="text-text-main">{formatCooldown(config?.backoffConfig?.max || 300000)}</code>
          </div>
          <div className="flex justify-between rounded-[10px] bg-bg px-4 py-3">
            <span className="text-text-muted">maxLevel</span>
            <code className="text-text-main">{config?.backoffConfig?.maxLevel || 15}</code>
          </div>
          <div className="flex justify-between rounded-[10px] bg-bg px-4 py-3">
            <span className="text-text-muted">transient cooldown</span>
            <code className="text-text-main">{formatCooldown(config?.transientCooldownMs || 30000)}</code>
          </div>
          <div className="flex justify-between rounded-[10px] bg-bg px-4 py-3">
            <span className="text-text-muted">max rate-limit cooldown</span>
            <code className="text-text-main">{formatCooldown(config?.maxRateLimitCooldownMs || 1800000)}</code>
          </div>
        </div>
      </Card>

      {/* Rule edit modal */}
      <Modal
        isOpen={showRuleModal}
        title={editingRuleIdx != null ? "编辑规则" : "新增规则"}
        onClose={() => setShowRuleModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-text-main">匹配文本（可选）</label>
            <Input
              placeholder="error body 中的关键字，如 rate limit"
              value={ruleForm.text}
              onChange={(e) => setRuleForm({ ...ruleForm, text: e.target.value })}
            />
            <p className="mt-1 text-xs text-text-muted">大小写不敏感子串匹配。留空则仅匹配状态码</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-text-main">HTTP 状态码（可选）</label>
            <Input
              placeholder="如 429"
              type="number"
              value={ruleForm.status}
              onChange={(e) => setRuleForm({ ...ruleForm, status: e.target.value })}
            />
            <p className="mt-1 text-xs text-text-muted">当文本不匹配时，按状态码兜底</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ruleForm.backoff}
                onChange={(e) => setRuleForm({ ...ruleForm, backoff: e.target.checked })}
              />
              使用指数退避
            </label>
          </div>
          {!ruleForm.backoff && (
            <div>
              <label className="mb-1 block text-sm font-medium text-text-main">固定冷却时间 (ms)</label>
              <Input
                placeholder="如 120000 (2分钟)"
                type="number"
                value={ruleForm.cooldownMs ?? ""}
                onChange={(e) => setRuleForm({ ...ruleForm, cooldownMs: e.target.value ? parseInt(e.target.value, 10) : null })}
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowRuleModal(false)}>取消</Button>
            <Button variant="primary" onClick={saveRule} disabled={!ruleForm.text.trim() && !ruleForm.status}>
              {editingRuleIdx != null ? "保存" : "添加"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Restore confirm */}
      <ConfirmModal
        isOpen={confirmRestore}
        title="恢复默认配置"
        message="此操作将删除本地自定义规则文件，恢复为内置默认规则。确定继续？"
        confirmText="恢复默认"
        variant="danger"
        onConfirm={handleRestoreDefault}
        onClose={() => setConfirmRestore(false)}
      />
    </div>
  );
}