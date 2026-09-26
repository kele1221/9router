"use client";

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import ResultCard, { Preview } from "./ResultCard";

const EFFORT_LABELS = { none: "不思考", low: "低", medium: "中", high: "高" };
const STATUS_LABELS = { pending: "排队中", running: "生成中", ok: "完成", error: "失败", timeout: "超时", canceled: "已取消" };

export default function ResultsMatrix({ run, results, thinkingEfforts, onScore, onRetry, showNotice }) {
  const [selected, setSelected] = useState(null);
  const models = run?.models || [...new Set(results.map((result) => result.model))];
  const efforts = (run?.thinkingEfforts?.length ? run.thinkingEfforts : thinkingEfforts).filter((effort) => EFFORT_LABELS[effort]);
  const resultMap = useMemo(() => new Map(results.map((result) => [`${result.model}\u0000${result.thinkingEffort || "none"}`, result])), [results]);
  const isArithmetic = run?.evaluationType === "arithmetic";

  if (!run) return null;
  return (
    <div className="overflow-x-auto rounded-[14px] border border-border-subtle bg-surface shadow-soft">
      <table className="min-w-[980px] w-full border-separate border-spacing-0 text-left">
        <thead className="bg-surface-2 text-xs text-text-muted">
          <tr>
            <th className="sticky left-0 z-20 min-w-48 border-b border-border-subtle bg-surface-2 px-4 py-3 font-medium">模型</th>
            {efforts.map((effort) => <th key={effort} className="min-w-56 border-b border-border-subtle px-3 py-3 text-center font-medium">{EFFORT_LABELS[effort]}</th>)}
            <th className="sticky right-0 z-20 min-w-44 border-b border-border-subtle bg-surface-2 px-4 py-3 text-center font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const row = efforts.map((effort) => resultMap.get(`${model}\u0000${effort}`)).filter(Boolean);
            const failed = row.filter((result) => !["ok", "pending", "running"].includes(result.status));
            return (
              <tr key={model} className="align-top hover:bg-surface-2/40">
                <th className="sticky left-0 z-10 border-b border-border-subtle bg-surface px-4 py-4 text-sm font-semibold text-text-main">
                  <span className="block max-w-44 truncate" title={model}>{model}</span>
                  <span className="mt-1 block text-[11px] font-normal text-text-muted">{row.length}/{efforts.length} 个结果</span>
                </th>
                {efforts.map((effort) => {
                  const result = resultMap.get(`${model}\u0000${effort}`);
                  if (!result) return <td key={effort} className="border-b border-border-subtle p-3"><div className="flex min-h-40 items-center justify-center rounded-[10px] border border-dashed border-border px-4 text-center text-xs text-text-muted">未执行或不支持</div></td>;
                  const status = STATUS_LABELS[result.status] || "等待中";
                  return (
                    <td key={effort} className="border-b border-border-subtle p-3">
                      <button
                        type="button"
                        onClick={() => setSelected(result)}
                        className="group block w-full rounded-[10px] text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                        aria-label={`${model} ${EFFORT_LABELS[effort]}结果详情`}
                      >
                        {result.status === "ok" && isArithmetic ? <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-[10px] bg-surface-2 px-4 text-center text-xs text-text-muted"><span className={`rounded-full px-2 py-1 font-medium ${result.autoEvaluation?.verdict === "correct" ? "bg-green-500/15 text-green-500" : result.autoEvaluation?.verdict === "incorrect" ? "bg-amber-500/15 text-amber-500" : "bg-red-500/15 text-red-500"}`}>{result.autoEvaluation?.verdict === "correct" ? "回答正确" : result.autoEvaluation?.verdict === "incorrect" ? "回答错误" : "格式无效"}</span><span>标准答案：{run.expectedAnswer}</span><span className="max-w-full truncate">回答：{result.rawText || "（空）"}</span></div> : result.status === "ok" ? <Preview code={result.code} height={180} autoHeight title={`${model}-${effort}`} /> : <div className="flex min-h-[180px] items-center justify-center rounded-[10px] bg-surface-2 text-xs text-text-muted">{status}</div>}
                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-text-muted"><span>{status}</span><span>{result.latencyMs ? `${(result.latencyMs / 1000).toFixed(1)}s` : "—"}</span></div>
                        {!isArithmetic && <div className="mt-1 text-[11px] text-text-muted">评分：{result.humanScore ?? "未评分"}</div>}
                      </button>
                    </td>
                  );
                })}
                <td className="sticky right-0 z-10 border-b border-border-subtle bg-surface p-3">
                  <div className="flex flex-col gap-2">
                    <Button size="sm" variant="secondary" icon="refresh" disabled={!failed.length} onClick={() => onRetry(failed.map((result) => result.id))}>重试失败{failed.length ? `（${failed.length}）` : ""}</Button>
                    {!isArithmetic && <Button size="sm" variant="ghost" icon="folder_zip" disabled={!row.some((result) => result.code)} onClick={() => window.open(`/api/model-eval/runs/${run.id}/download?model=${encodeURIComponent(model)}`, "_blank")}>下载该模型</Button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {selected && <Modal isOpen size="xl" title={`${selected.model} · ${EFFORT_LABELS[selected.thinkingEffort || "none"]}`} onClose={() => setSelected(null)}><ResultCard result={selected} evaluationType={run.evaluationType} expectedAnswer={run.expectedAnswer} onScore={onScore} onRetry={(id) => onRetry([id])} showNotice={showNotice} /></Modal>}
    </div>
  );
}

ResultsMatrix.propTypes = {
  run: PropTypes.object,
  results: PropTypes.array.isRequired,
  thinkingEfforts: PropTypes.array.isRequired,
  onScore: PropTypes.func.isRequired,
  onRetry: PropTypes.func.isRequired,
  showNotice: PropTypes.func,
};
