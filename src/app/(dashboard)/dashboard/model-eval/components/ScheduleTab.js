"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Button, Card, ConfirmModal, Modal, Toggle } from "@/shared/components";
import ModelSelector from "./ModelSelector";
import { cn } from "@/shared/utils/cn";

const MODES = [
  { value: "hourly", label: "每小时" },
  { value: "daily", label: "每天定时" },
  { value: "cron", label: "Cron 表达式" },
];

const emptyDraft = { id: null, name: "", models: [], promptId: "", mode: "daily", dailyTime: "09:00", cronExpr: "", enabled: true };
const THINKING_EFFORTS = [
  { value: "none", label: "不思考" }, { value: "low", label: "低" }, { value: "medium", label: "中" }, { value: "high", label: "高" },
];

function describe(schedule) {
  if (schedule.mode === "hourly") return "每小时执行一次";
  if (schedule.mode === "daily") return `每天 ${schedule.dailyTime}`;
  return `Cron: ${schedule.cronExpr}`;
}

export default function ScheduleTab({ activeProviders, modelAliases, prompts, onRunStarted, showNotice }) {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/model-eval/schedules", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setSchedules(data.schedules || []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        showNotice?.("加载定时任务失败");
      });
    return () => { cancelled = true; };
  }, [reloadKey, showNotice]);

  const openNew = () => {
    const defaultPrompt = prompts.find((p) => p.builtin)?.id || prompts[0]?.id || "";
    setDraft({ ...emptyDraft, promptId: defaultPrompt, thinkingEfforts: ["none"] });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const payload = {
        name: draft.name,
        models: draft.models,
        thinkingEfforts: draft.thinkingEfforts || ["none"],
        promptId: draft.promptId,
        mode: draft.mode,
        dailyTime: draft.mode === "daily" ? draft.dailyTime : null,
        cronExpr: draft.mode === "cron" ? draft.cronExpr : null,
        enabled: draft.enabled,
      };
      const res = await fetch(draft.id ? `/api/model-eval/schedules/${draft.id}` : "/api/model-eval/schedules", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");
      showNotice?.(draft.id ? "任务已更新" : "任务已创建");
      setDraft(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      showNotice?.(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (schedule) => {
    const res = await fetch(`/api/model-eval/schedules/${schedule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !schedule.enabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) showNotice?.(data.error || "更新失败");
    else setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? data.schedule : s)));
  };

  const runNow = async (schedule) => {
    setRunningId(schedule.id);
    try {
      const res = await fetch(`/api/model-eval/schedules/${schedule.id}/run`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "启动失败");
      showNotice?.("已手动触发该任务");
      onRunStarted(data.run);
      setReloadKey((k) => k + 1);
    } catch (err) {
      showNotice?.(err.message);
    } finally {
      setRunningId(null);
    }
  };

  const remove = async (schedule) => {
    const res = await fetch(`/api/model-eval/schedules/${schedule.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) showNotice?.(data.error || "删除失败");
    else {
      showNotice?.("任务已删除");
      setReloadKey((k) => k + 1);
    }
    setConfirmDelete(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="定时评测任务"
        subtitle="后台按计划自动跑指定模型清单；单进程调度，错过的时间窗不会重复补跑。"
        icon="schedule"
        padding="sm"
        action={<Button size="sm" icon="add" onClick={openNew}>新建任务</Button>}
      >
        {loading && <p className="text-sm text-text-muted">加载中…</p>}
        {!loading && schedules.length === 0 && <p className="text-sm text-text-muted">还没有定时任务。</p>}
        <div className="flex flex-col">
          {schedules.map((schedule) => (
            <div key={schedule.id} className="flex flex-wrap items-center gap-3 py-2 border-b border-border-subtle/60 last:border-b-0">
              <Toggle checked={schedule.enabled} onChange={() => toggleEnabled(schedule)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-main truncate">{schedule.name}</p>
                <p className="text-[11px] text-text-muted">
                  {describe(schedule)} · {schedule.models.length} 个模型 · {(schedule.thinkingEfforts || ["none"]).join(" / ")}
                  {schedule.lastRunAt ? ` · 上次 ${new Date(schedule.lastRunAt).toLocaleString()}` : " · 尚未执行"}
                  {schedule.lastError ? ` · 异常：${schedule.lastError}` : ""}
                </p>
              </div>
              <span className={cn("px-2 py-0.5 rounded-[6px] text-[11px]", schedule.enabled ? "bg-green-500/15 text-green-500" : "bg-surface-3 text-text-muted")}>
                {schedule.enabled ? "启用" : "停用"}
              </span>
              <Button size="sm" variant="secondary" icon="bolt" loading={runningId === schedule.id} onClick={() => runNow(schedule)}>立即执行</Button>
              <Button size="sm" variant="ghost" icon="edit" onClick={() => setDraft({ ...schedule })}>编辑</Button>
              <Button size="sm" variant="ghost" icon="delete" onClick={() => setConfirmDelete(schedule)}>删除</Button>
            </div>
          ))}
        </div>
      </Card>

      {draft && (
        <Modal
          isOpen
          size="lg"
          onClose={() => setDraft(null)}
          title={draft.id ? "编辑定时任务" : "新建定时任务"}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setDraft(null)}>取消</Button>
              <Button loading={saving} onClick={save}>保存</Button>
            </>
          )}
        >
          <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto pr-1">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="任务名称"
              className="w-full py-2 px-3 text-sm bg-surface-2 border border-transparent rounded-[10px] text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-text-main">执行频率</p>
              <div className="flex flex-wrap items-center gap-2">
                {MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setDraft({ ...draft, mode: mode.value })}
                    className={cn(
                      "px-3 py-1.5 text-xs rounded-[8px] font-medium transition-colors",
                      draft.mode === mode.value ? "bg-brand-500/15 text-primary" : "bg-surface-2 text-text-muted hover:text-text-main"
                    )}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              {draft.mode === "daily" && (
                <input
                  type="time"
                  value={draft.dailyTime || "09:00"}
                  onChange={(e) => setDraft({ ...draft, dailyTime: e.target.value })}
                  className="w-40 py-2 px-3 text-sm bg-surface-2 border border-transparent rounded-[10px] text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              )}
              {draft.mode === "cron" && (
                <div className="flex flex-col gap-1">
                  <input
                    value={draft.cronExpr || ""}
                    onChange={(e) => setDraft({ ...draft, cronExpr: e.target.value })}
                    placeholder="分 时 日 月 周，例如 0 */6 * * *"
                    className="w-full py-2 px-3 text-sm font-mono bg-surface-2 border border-transparent rounded-[10px] text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                  <p className="text-[11px] text-text-muted">5 字段：分 时 日 月 周，支持 * 、*/n、a-b、a,b</p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-text-main">思考深度</p>
              <div className="flex flex-wrap gap-2">
                {THINKING_EFFORTS.map((effort) => {
                  const active = (draft.thinkingEfforts || ["none"]).includes(effort.value);
                  return <button key={effort.value} type="button" onClick={() => {
                    const current = draft.thinkingEfforts || ["none"];
                    const next = active ? (current.length === 1 ? current : current.filter((value) => value !== effort.value)) : [...current, effort.value];
                    setDraft({ ...draft, thinkingEfforts: next });
                  }} className={`rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-brand-500/15 text-primary" : "bg-surface-2 text-text-muted hover:text-text-main"}`}>{effort.label}</button>;
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-text-main">Prompt</p>
              <select
                value={draft.promptId || ""}
                onChange={(e) => setDraft({ ...draft, promptId: e.target.value })}
                className="w-full py-2 px-3 text-sm bg-surface-2 border border-transparent rounded-[10px] text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                <option value="" disabled>选择 Prompt</option>
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>{p.builtin ? "内置" : "自定义"} · {p.evaluationType === "arithmetic" ? "算术" : "可视化"} · {p.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-text-main">模型清单（固定，不会随账号变化自动扩展）</p>
              <ModelSelector
                selected={draft.models}
                onChange={(next) => setDraft({ ...draft, models: next })}
                activeProviders={activeProviders}
                modelAliases={modelAliases}
                maxHeight={220}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-text-main">
              <Toggle checked={draft.enabled} onChange={() => setDraft({ ...draft, enabled: !draft.enabled })} />
              启用该任务
            </label>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen
          confirmText="删除"
          title="删除定时任务"
          message={`确定删除「${confirmDelete.name}」？已产生的历史评测记录会保留。`}
          onConfirm={() => remove(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

ScheduleTab.propTypes = {
  activeProviders: PropTypes.array.isRequired,
  modelAliases: PropTypes.object.isRequired,
  prompts: PropTypes.array.isRequired,
  onRunStarted: PropTypes.func.isRequired,
  showNotice: PropTypes.func,
};
