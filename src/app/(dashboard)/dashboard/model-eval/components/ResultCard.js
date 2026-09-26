"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const STATUS_STYLES = {
  pending: { label: "排队中", className: "bg-surface-3 text-text-muted" },
  running: { label: "测试中", className: "bg-brand-500/15 text-brand-500" },
  ok: { label: "完成", className: "bg-green-500/15 text-green-500" },
  error: { label: "失败", className: "bg-red-500/15 text-red-500" },
  timeout: { label: "超时", className: "bg-amber-500/15 text-amber-500" },
  canceled: { label: "已取消", className: "bg-surface-3 text-text-muted" },
};
const EFFORT_LABELS = { none: "不思考", low: "低", medium: "中", high: "高" };

// Generated markup runs in an isolated origin: allow-scripts without
// allow-same-origin, so model-authored JS cannot touch the dashboard.
const PREVIEW_HEIGHT_MESSAGE = "9router-model-eval-preview-height";

function withHeightReporter(code) {
  const reporter = `<script>(${function () {
    const report = () => parent.postMessage({ type: "9router-model-eval-preview-height", height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) }, "*");
    new ResizeObserver(report).observe(document.documentElement);
    addEventListener("load", report);
    setTimeout(report, 100);
    setTimeout(report, 500);
  }.toString()})()</script>`;
  return /<\/body\s*>/i.test(code) ? code.replace(/<\/body\s*>/i, `${reporter}</body>`) : `${code}${reporter}`;
}

export function Preview({ code, height, className, title, autoHeight = false }) {
  const frameRef = useRef(null);
  const [measuredHeight, setMeasuredHeight] = useState(height);

  useEffect(() => {
    if (!autoHeight) return undefined;
    const onMessage = (event) => {
      if (event.source !== frameRef.current?.contentWindow || event.data?.type !== PREVIEW_HEIGHT_MESSAGE) return;
      const next = Number(event.data.height);
      if (Number.isFinite(next) && next > 0) setMeasuredHeight(Math.ceil(next) + 2);
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [autoHeight]);

  if (!code) {
    return (
      <div className={cn("flex items-center justify-center rounded-[10px] bg-surface-2 text-xs text-text-muted", className)}>
        没有可预览的代码
      </div>
    );
  }
  return (
    <iframe
      ref={frameRef}
      title={title}
      sandbox="allow-scripts"
      srcDoc={autoHeight ? withHeightReporter(code) : code}
      className={cn("w-full rounded-[10px] border border-border-subtle bg-white", className)}
      style={{ height: autoHeight ? measuredHeight : height }}
    />
  );
}

Preview.propTypes = {
  code: PropTypes.string,
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  className: PropTypes.string,
  title: PropTypes.string,
  autoHeight: PropTypes.bool,
};

function Marker({ active, label }) {
  return (
    <span className={cn(
      "px-2 py-0.5 rounded-[6px] text-[11px] font-medium",
      active ? "bg-green-500/15 text-green-500" : "bg-surface-3 text-text-muted"
    )}>
      {label}
    </span>
  );
}

Marker.propTypes = { active: PropTypes.bool, label: PropTypes.string };

const VERDICT_STYLES = {
  correct: { label: "回答正确", className: "bg-green-500/15 text-green-500" },
  incorrect: { label: "回答错误", className: "bg-amber-500/15 text-amber-500" },
  invalid: { label: "格式无效", className: "bg-red-500/15 text-red-500" },
};

export default function ResultCard({ result, evaluationType = "visual", expectedAnswer = null, onScore, onRetry, showNotice, compact = false }) {
  const [score, setScore] = useState(result.humanScore ?? "");
  const [note, setNote] = useState(result.humanNote ?? "");
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  const status = STATUS_STYLES[result.status] || STATUS_STYLES.pending;
  const markers = result.markers || {};
  const isArithmetic = evaluationType === "arithmetic" || Boolean(result.autoEvaluation);

  const submitScore = async (nextScore) => {
    setSaving(true);
    const ok = await onScore(result.id, {
      humanScore: nextScore === "" ? null : Number(nextScore),
      humanNote: note,
    });
    setSaving(false);
    if (ok && nextScore !== "") showNotice?.(`已保存 ${result.model} 评分 ${nextScore}`);
    return ok;
  };

  const submitNote = async () => {
    setSavingNote(true);
    await onScore(result.id, { humanScore: score === "" ? null : Number(score), humanNote: note });
    setSavingNote(false);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(result.code || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showNotice?.("复制失败，请手动选择代码");
    }
  };

  const retry = async () => {
    setRetrying(true);
    const ok = await onRetry(result.id);
    setRetrying(false);
    if (ok) showNotice?.(`已重新排队 ${result.model}`);
  };

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-border-subtle bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-main truncate" title={result.model}>{result.model}</p>
          <p className="text-[11px] text-text-muted mt-0.5">
            {EFFORT_LABELS[result.thinkingEffort || "none"] || result.thinkingEffort || "不思考"} ·
            {result.latencyMs ? `${(result.latencyMs / 1000).toFixed(1)}s` : "—"}
            {result.usage?.completion_tokens ? ` · ${result.usage.completion_tokens} tokens` : ""}
            {result.finishReason ? ` · ${result.finishReason}` : ""}
          </p>
        </div>
        <span className={cn("shrink-0 px-2 py-0.5 rounded-[6px] text-[11px] font-medium", status.className)}>{status.label}</span>
      </div>

      {isArithmetic && (() => {
        const verdict = VERDICT_STYLES[result.autoEvaluation?.verdict] || null;
        return (
          <>
            {result.status === "pending" || result.status === "running" ? <div className="flex items-center justify-center rounded-[10px] bg-surface-2 text-xs text-text-muted" style={{ height: compact ? 160 : 260 }}>正在生成答案…</div> : <div className="flex flex-col gap-2 rounded-[10px] bg-surface-2 p-4 text-sm text-text-main"><div className="flex flex-wrap items-center gap-2"><span className={cn("px-2 py-0.5 rounded-[6px] text-[11px] font-medium", verdict?.className || "bg-surface-3 text-text-muted")}>{verdict?.label || "未判定"}</span><span>标准答案：{result.autoEvaluation?.expectedAnswer ?? expectedAnswer ?? "—"}</span></div><p className="text-xs text-text-muted">模型原文回答</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-bg p-3 text-xs text-text-main">{result.rawText || "（空）"}</pre>{result.autoEvaluation?.normalizedAnswer !== null && result.autoEvaluation?.normalizedAnswer !== undefined && <p className="text-xs text-text-muted">规范化答案：{result.autoEvaluation.normalizedAnswer}</p>}</div>}
            {result.error && <p className="text-[11px] text-red-500 break-words">{result.error}</p>}
            {onRetry && !["ok", "pending", "running"].includes(result.status) && <Button size="sm" variant="secondary" icon="refresh" loading={retrying} onClick={retry}>重试</Button>}
          </>
        );
      })()}

      {!isArithmetic && (result.status === "pending" || result.status === "running" ? (
        <div className="flex items-center justify-center rounded-[10px] bg-surface-2 text-xs text-text-muted" style={{ height: compact ? 160 : 260 }}>
          <span className="material-symbols-outlined animate-spin mr-2 text-[16px]">progress_activity</span>
          {result.status === "running" ? "正在生成，慢模型可能要等数分钟" : "等待执行"}
        </div>
      ) : (
        <Preview code={result.code} height={compact ? 160 : 260} title={`preview-${result.model}`} />
      ))}

      {!isArithmetic && <div className="flex flex-wrap items-center gap-2">
        <Marker active={Boolean(markers.hasSvg)} label="SVG" />
        <Marker active={Boolean(markers.hasAnimation)} label="动画" />
        <Marker active={Boolean(markers.hasScript)} label="脚本" />
        {markers.truncated && <span className="px-2 py-0.5 rounded-[6px] text-[11px] font-medium bg-amber-500/15 text-amber-500">输出截断</span>}
      </div>}

      {!isArithmetic && result.error && (
        <p className="text-[11px] text-red-500 break-words">{result.error}</p>
      )}

      {!isArithmetic && result.filePath && (
        <p className="text-[11px] text-text-muted break-all" title={result.filePath}>
          <span className="material-symbols-outlined text-[12px] align-middle mr-1">folder</span>
          已存盘：{result.filePath}
        </p>
      )}

      {!isArithmetic && <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min="0"
          max="100"
          value={score}
          onChange={(e) => setScore(e.target.value)}
          placeholder="人工分 0-100"
          className="w-28 py-1.5 px-2 text-sm bg-surface-2 border border-transparent rounded-[8px] text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        <Button size="sm" variant="secondary" loading={saving} onClick={() => submitScore(score)}>保存评分</Button>
        {onRetry && !["ok", "pending", "running"].includes(result.status) && (
          <Button size="sm" variant="secondary" icon="refresh" loading={retrying} onClick={retry}>重试</Button>
        )}
        <Button size="sm" variant="ghost" icon="download" onClick={() => window.open(`/api/model-eval/results/${result.id}/download`, "_blank")}>
          源码
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowCode((v) => !v)}>
          {showCode ? "隐藏代码" : "查看代码"}
        </Button>
        {result.code && (
          <>
            <Button size="sm" variant="ghost" onClick={copyCode}>{copied ? "已复制" : "复制"}</Button>
            <Button size="sm" variant="ghost" icon="fullscreen" onClick={() => setFullscreen(true)}>全屏预览</Button>
          </>
        )}
      </div>}

      {!isArithmetic && <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={submitNote}
        rows={2}
        placeholder="人工备注（失焦自动保存）"
        className="w-full py-1.5 px-2 text-xs bg-surface-2 border border-transparent rounded-[8px] text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-y"
      />}
      {!isArithmetic && savingNote && <span className="text-[11px] text-text-muted">保存备注…</span>}

      {!isArithmetic && showCode && (
        <pre className="max-h-72 overflow-auto rounded-[10px] bg-bg p-3 text-[11px] leading-relaxed text-text-muted whitespace-pre-wrap break-words">
          {result.code || result.rawText || "（无内容）"}
        </pre>
      )}

      {!isArithmetic && fullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-6" onClick={() => setFullscreen(false)}>
          <div className="flex items-center justify-between mb-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-white">{result.model}</p>
            <Button size="sm" variant="secondary" onClick={() => setFullscreen(false)}>关闭</Button>
          </div>
          <div className="flex-1 min-h-0" onClick={(e) => e.stopPropagation()}>
            <Preview code={result.code} height="100%" className="h-full" title={`fullscreen-${result.model}`} />
          </div>
        </div>
      )}
    </div>
  );
}

ResultCard.propTypes = {
  result: PropTypes.object.isRequired,
  evaluationType: PropTypes.oneOf(["visual", "arithmetic"]),
  expectedAnswer: PropTypes.string,
  onScore: PropTypes.func.isRequired,
  onRetry: PropTypes.func,
  showNotice: PropTypes.func,
  compact: PropTypes.bool,
};
