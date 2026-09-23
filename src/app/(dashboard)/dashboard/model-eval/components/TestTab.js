"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Button, Card } from "@/shared/components";
import ModelSelector from "./ModelSelector";
import PromptSelect from "./PromptSelect";
import ResultCard from "./ResultCard";

const STORAGE_KEY = "9r-model-eval-selection";

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

  // Derived, not stored: keep the selection if it still exists, else fall back
  // to the first prompt that is loaded.
  const activePromptId = prompts.some((p) => p.id === promptId)
    ? promptId
    : (prompts.find((p) => p.builtin)?.id ?? prompts[0]?.id ?? "");

  useEffect(() => {
    if (!selectedModels.length && !activePromptId) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ models: selectedModels, promptId: activePromptId }));
    } catch {}
  }, [selectedModels, activePromptId]);

  const finished = results.filter((r) => r.status !== "pending" && r.status !== "running").length;
  const scored = results.filter((r) => r.humanScore !== null && r.humanScore !== undefined).length;
  const retryable = results.filter((r) => !["ok", "pending", "running"].includes(r.status)).length;

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
            <PromptSelect
              prompts={prompts}
              value={activePromptId}
              onChange={setPromptId}
              onPromptsChanged={onPromptsChanged}
              showNotice={showNotice}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                icon="play_arrow"
                disabled={busy || !selectedModels.length || !activePromptId}
                onClick={() => onStart({ models: selectedModels, promptId: activePromptId })}
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
            {results.some((r) => r.code) && (
              <Button
                size="sm"
                variant="secondary"
                icon="folder_zip"
                onClick={() => window.open(`/api/model-eval/runs/${run.id}/download`, "_blank")}
              >
                导出本轮源码 ZIP
              </Button>
            )}
            {!busy && retryable > 0 && (
              <Button size="sm" variant="secondary" icon="refresh" onClick={() => onRetry(null)}>
                重试失败项（{retryable}）
              </Button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {results.map((result) => (
              <ResultCard
                key={result.id}
                result={result}
                onScore={onScore}
                onRetry={onRetry ? (resultId) => onRetry([resultId]) : null}
                showNotice={showNotice}
              />
            ))}
          </div>
        </div>
      )}

      {!run && (
        <Card padding="sm">
          <p className="text-sm text-text-muted">
            选择模型与 Prompt 后点击「开始测试」。每个模型的结果会在下方卡片内直接渲染,并排对比画面效果。
          </p>
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
