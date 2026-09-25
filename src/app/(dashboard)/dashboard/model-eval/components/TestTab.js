"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Button, Card } from "@/shared/components";
import ModelSelector from "./ModelSelector";
import PromptSelect from "./PromptSelect";
import ResultsMatrix from "./ResultsMatrix";

const STORAGE_KEY = "9r-model-eval-selection";
const THINKING_EFFORTS = [
  { value: "none", label: "不思考" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

function loadRemembered() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function TestTab({ activeProviders, modelAliases, prompts, run, results, busy, onStart, onCancel, onScore, onRetry, onPromptsChanged, showNotice }) {
  // Restored from the last session during the initial render, so no effect is
  // needed to hydrate the form.
  const [selectedModels, setSelectedModels] = useState(() => {
    const remembered = loadRemembered();
    return Array.isArray(remembered?.models) ? remembered.models.filter((m) => typeof m === "string") : [];
  });
  const [promptId, setPromptId] = useState(() => loadRemembered()?.promptId || "");
  const [evaluationType, setEvaluationType] = useState(() => loadRemembered()?.evaluationType === "arithmetic" ? "arithmetic" : "visual");
  const [thinkingEfforts, setThinkingEfforts] = useState(() => {
    const remembered = loadRemembered();
    return Array.isArray(remembered?.thinkingEfforts) && remembered.thinkingEfforts.length ? remembered.thinkingEfforts : ["none"];
  });

  // Derived, not stored: keep the selection if it still exists, else fall back
  // to the first prompt that is loaded.
  const typedPrompts = prompts.filter((p) => (p.evaluationType || "visual") === evaluationType);
  const activePromptId = typedPrompts.some((p) => p.id === promptId)
    ? promptId
    : (typedPrompts.find((p) => p.builtin)?.id ?? typedPrompts[0]?.id ?? "");

  useEffect(() => {
    if (!selectedModels.length && !activePromptId) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ models: selectedModels, promptId: activePromptId, evaluationType, thinkingEfforts }));
    } catch {}
  }, [selectedModels, activePromptId, evaluationType, thinkingEfforts]);

  const finished = results.filter((r) => r.status !== "pending" && r.status !== "running").length;
  const scored = results.filter((r) => r.humanScore !== null && r.humanScore !== undefined).length;
  const targetCount = selectedModels.length * thinkingEfforts.length;
  const toggleEffort = (effort) => setThinkingEfforts((current) => current.includes(effort)
    ? current.length === 1 ? current : current.filter((value) => value !== effort)
    : [...current, effort]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card title="选择对话模型" icon="smart_toy" padding="sm">
          <ModelSelector
            selected={selectedModels}
            onChange={setSelectedModels}
            activeProviders={activeProviders}
            modelAliases={modelAliases}
          />
        </Card>
        <Card title="测试配置" icon="tune" padding="sm">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-text-main">评测类型</p>
              <div className="flex flex-wrap gap-2">
                {[{ value: "visual", label: "可视化代码" }, { value: "arithmetic", label: "算术答题" }].map((type) => (
                  <button key={type.value} type="button" onClick={() => setEvaluationType(type.value)} className={`rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${evaluationType === type.value ? "bg-brand-500/15 text-primary" : "bg-surface-2 text-text-muted hover:text-text-main"}`}>{type.label}</button>
                ))}
              </div>
            </div>
            <PromptSelect
              prompts={typedPrompts}
              value={activePromptId}
              onChange={setPromptId}
              evaluationType={evaluationType}
              onPromptsChanged={onPromptsChanged}
              showNotice={showNotice}
            />
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-text-main">本次思考深度</p>
              <div className="flex flex-wrap gap-2">
                {THINKING_EFFORTS.map((effort) => (
                  <button key={effort.value} type="button" onClick={() => toggleEffort(effort.value)} className={`rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${thinkingEfforts.includes(effort.value) ? "bg-brand-500/15 text-primary" : "bg-surface-2 text-text-muted hover:text-text-main"}`}>
                    {effort.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-muted">将生成最多 {targetCount} 个模型 × 思考深度组合；不支持的组合会自动跳过。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                icon="play_arrow"
                disabled={busy || !selectedModels.length || !activePromptId || targetCount > 50}
                onClick={() => onStart({ models: selectedModels, promptId: activePromptId, thinkingEfforts })}
              >
                开始测试
              </Button>
              {busy && <Button variant="danger" icon="stop" onClick={onCancel}>取消评测</Button>}
              <span className="text-xs text-text-muted">
                {run ? `本轮 ${results.length} 个模型 · 完成 ${finished}/${results.length} · 已评分 ${scored}` : "尚未开始"}
              </span>
            </div>
            {busy && (
              <p className="text-[11px] text-text-muted">
                按供应商并行、同一供应商内串行；单个模型可能要等数分钟，页面每 2 秒刷新一次，可以切到其他页签，评测在后台继续。
              </p>
            )}
          </div>
        </Card>
      </div>

      {run && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-text-main">
                {run.promptName || "本次评测"}
                <span className="ml-2 text-[11px] font-normal text-text-muted">
                  {run.source === "schedule" ? "定时触发" : "手动触发"} · {new Date(run.startedAt).toLocaleString()}
                </span>
              </p>
              <p className="text-[11px] text-text-muted mt-0.5">状态：{run.status}{run.error ? ` · ${run.error}` : ""}</p>
            </div>
            {run.evaluationType !== "arithmetic" && results.some((r) => r.code) && (
              <Button
                size="sm"
                variant="secondary"
                icon="folder_zip"
                onClick={() => window.open(`/api/model-eval/runs/${run.id}/download`, "_blank")}
              >
                导出本轮源码 ZIP
              </Button>
            )}
          </div>

          <ResultsMatrix run={run} results={results} thinkingEfforts={thinkingEfforts} onScore={onScore} onRetry={onRetry} showNotice={showNotice} />
        </div>
      )}

      {!run && (
        <Card padding="sm">
          <p className="text-sm text-text-muted">选择模型与 Prompt 后点击「开始测试」。可视化模式会并排渲染画面；算术模式会自动判定单个数值答案。</p>
        </Card>
      )}
    </div>
  );
}

TestTab.propTypes = {
  activeProviders: PropTypes.array.isRequired,
  modelAliases: PropTypes.object.isRequired,
  prompts: PropTypes.array.isRequired,
  run: PropTypes.object,
  results: PropTypes.array.isRequired,
  busy: PropTypes.bool,
  onStart: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  onScore: PropTypes.func.isRequired,
  onRetry: PropTypes.func.isRequired,
  onPromptsChanged: PropTypes.func.isRequired,
  showNotice: PropTypes.func,
};
