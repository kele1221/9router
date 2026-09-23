"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { Preview } from "./ResultCard";

const STATUS_STYLES = {
  pending: { label: "排队中", className: "bg-surface-3 text-text-muted" },
  running: { label: "测试中", className: "bg-brand-500/15 text-brand-500" },
  ok: { label: "完成", className: "bg-green-500/15 text-green-500" },
  error: { label: "失败", className: "bg-red-500/15 text-red-500" },
  timeout: { label: "超时", className: "bg-amber-500/15 text-amber-500" },
  canceled: { label: "已取消", className: "bg-surface-3 text-text-muted" },
};
const PAGE_SIZE = 24;

function MetaChip({ children }) {
  return <span className="px-2 py-0.5 rounded-[6px] text-[11px] font-medium bg-surface-3 text-text-muted">{children}</span>;
}

MetaChip.propTypes = { children: PropTypes.node };

export default function ModelPreviewsPage({ model, onBack, showNotice }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fullscreen, setFullscreen] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResults([]);
    setHasMore(false);
    fetch(`/api/model-eval/results?model=${encodeURIComponent(model)}&limit=${PAGE_SIZE}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setResults(data.results || []);
        setHasMore(Boolean(data.hasMore));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        showNotice?.("加载历史预览失败");
      });
    return () => { cancelled = true; };
  }, [model, showNotice]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/model-eval/results?model=${encodeURIComponent(model)}&limit=${PAGE_SIZE}&offset=${results.length}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      setResults((current) => [...current, ...(data.results || [])]);
      setHasMore(Boolean(data.hasMore));
    } catch {
      showNotice?.("加载更多历史预览失败");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-text-main">
            <span className="material-symbols-outlined text-[26px] text-primary">preview</span>
            <span className="truncate" title={model}>{model}</span>
          </h2>
          <p className="mt-1 text-sm text-text-muted">该模型历史生成的 HTML 预览，按生成时间从新到旧排列。</p>
        </div>
        <Button variant="secondary" icon="arrow_back" onClick={onBack}>返回排行榜</Button>
      </header>

      {loading && <p className="text-sm text-text-muted">加载中…</p>}
      {!loading && results.length === 0 && <p className="text-sm text-text-muted">该模型还没有生成记录。</p>}
      {!loading && results.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {results.map((result) => {
            const status = STATUS_STYLES[result.status] || STATUS_STYLES.pending;
            return (
              <article key={result.id} className="flex flex-col gap-2 rounded-[14px] border border-border-subtle bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("shrink-0 px-2 py-0.5 rounded-[6px] text-[11px] font-medium", status.className)}>{status.label}</span>
                  <span className="text-[11px] text-text-muted truncate max-w-[160px]" title={result.promptName}>
                    {result.promptName || "（未命名 Prompt）"}
                  </span>
                  <span className="text-[11px] text-text-muted">{new Date(result.startedAt || result.createdAt).toLocaleString()}</span>
                  <span className="ml-auto text-[11px] font-semibold text-text-main">{result.humanScore ?? "—"} 分</span>
                </div>

                <Preview code={result.code} height={220} title={`preview-${result.id}`} />

                <div className="flex flex-wrap items-center gap-2">
                  {result.markers?.hasSvg && <MetaChip>SVG</MetaChip>}
                  {result.markers?.hasAnimation && <MetaChip>动画</MetaChip>}
                  {result.markers?.truncated && <MetaChip>输出截断</MetaChip>}
                  {result.source === "schedule" && <MetaChip>定时</MetaChip>}
                  {result.latencyMs ? <MetaChip>{(result.latencyMs / 1000).toFixed(1)}s</MetaChip> : null}
                  <div className="ml-auto flex items-center gap-1">
                    <Button size="sm" variant="ghost" icon="download" onClick={() => window.open(`/api/model-eval/results/${result.id}/download`, "_blank")}>
                      源码
                    </Button>
                    {result.code && (
                      <Button size="sm" variant="ghost" icon="fullscreen" onClick={() => setFullscreen(result)}>全屏</Button>
                    )}
                  </div>
                </div>

                {result.error && <p className="text-[11px] text-red-500 break-words">{result.error}</p>}
              </article>
            );
          })}
        </div>
      )}
      {!loading && hasMore && (
        <div className="flex justify-center pt-1">
          <Button size="sm" variant="secondary" loading={loadingMore} onClick={loadMore}>加载更多</Button>
        </div>
      )}

      {fullscreen && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/70 p-6" onClick={() => setFullscreen(null)}>
          <div className="flex items-center justify-between mb-3" onClick={(event) => event.stopPropagation()}>
            <p className="text-sm font-semibold text-white">{fullscreen.promptName || fullscreen.model}</p>
            <Button size="sm" variant="secondary" onClick={() => setFullscreen(null)}>关闭</Button>
          </div>
          <div className="flex-1 min-h-0" onClick={(event) => event.stopPropagation()}>
            <Preview code={fullscreen.code} height="100%" className="h-full" title={`fullscreen-${fullscreen.id}`} />
          </div>
        </div>
      )}
    </section>
  );
}

ModelPreviewsPage.propTypes = {
  model: PropTypes.string.isRequired,
  onBack: PropTypes.func.isRequired,
  showNotice: PropTypes.func,
};
