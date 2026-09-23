"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Button, Card, ConfirmModal } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const STATUS_LABELS = { running: "运行中", done: "完成", failed: "全部失败", canceled: "已取消" };

export default function HistoryTab({ onOpenRun, showNotice }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/model-eval/runs?limit=100", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setRuns(data.runs || []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        showNotice?.("加载历史记录失败");
      });
    return () => { cancelled = true; };
  }, [reloadKey, showNotice]);

  const open = async (run) => {
    const res = await fetch(`/api/model-eval/runs/${run.id}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showNotice?.(data.error || "打开失败");
      return;
    }
    onOpenRun({ run: data.run, results: data.results });
  };

  const remove = async (run) => {
    const res = await fetch(`/api/model-eval/runs/${run.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) showNotice?.(data.error || "删除失败");
    else {
      showNotice?.("已删除该轮评测记录");
      setReloadKey((k) => k + 1);
    }
    setConfirmDelete(null);
  };

  return (
    <Card title="评测历史" icon="history" padding="sm" action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => setReloadKey((k) => k + 1)}>刷新</Button>}>
      {loading && <p className="text-sm text-text-muted">加载中…</p>}
      {!loading && runs.length === 0 && <p className="text-sm text-text-muted">还没有评测记录。</p>}
      <div className="flex flex-col">
        {runs.map((run) => (
          <div key={run.id} className="flex flex-wrap items-center gap-3 py-2 border-b border-border-subtle/60 last:border-b-0">
            <span className={cn(
              "px-2 py-0.5 rounded-[6px] text-[11px] font-medium",
              run.status === "running" ? "bg-brand-500/15 text-primary"
                : run.status === "done" ? "bg-green-500/15 text-green-500"
                  : "bg-surface-3 text-text-muted"
            )}>
              {STATUS_LABELS[run.status] || run.status}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-main truncate" title={run.promptName}>{run.promptName || "（未命名 Prompt）"}</p>
              <p className="text-[11px] text-text-muted">
                {new Date(run.startedAt).toLocaleString()} · {run.models.length} 个模型 · {run.source === "schedule" ? "定时" : "手动"}
              </p>
            </div>
            <Button size="sm" variant="ghost" icon="visibility" onClick={() => open(run)}>查看</Button>
            <Button size="sm" variant="ghost" icon="delete" onClick={() => setConfirmDelete(run)}>删除</Button>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <ConfirmModal
          isOpen
          confirmText="删除"
          title="删除评测记录"
          message="删除后该轮的所有生成结果与评分都会移除，无法恢复。"
          onConfirm={() => remove(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </Card>
  );
}

HistoryTab.propTypes = {
  onOpenRun: PropTypes.func.isRequired,
  showNotice: PropTypes.func,
};
