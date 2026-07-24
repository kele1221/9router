"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";

const POLL_INTERVAL_MS = 15000;

export default function RateLimitNormalizationNotice() {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let active = true;

    const loadSummary = async () => {
      try {
        const response = await fetch("/api/fork/rate-limit-normalizations", { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json();
        if (active) setSummary(next);
      } catch {
        // The dashboard notice is informational and must never affect proxy use.
      }
    };

    loadSummary();
    const timer = setInterval(loadSummary, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (!summary?.totalCount || !summary.lastEvent) return null;

  const event = summary.lastEvent;
  const occurredAt = new Date(event.occurredAt);
  const readableTime = Number.isNaN(occurredAt.getTime())
    ? event.occurredAt
    : occurredAt.toLocaleString("zh-CN", { hour12: false });

  return (
    <Card
      padding="sm"
      className="border-warning/40 bg-warning/5"
      aria-live="polite"
      data-event="RATE_LIMIT_NORMALIZED"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-warning/15 text-warning">
            <span className="material-symbols-outlined text-[22px]">published_with_changes</span>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-text-main">已自动修正供应商限流状态</h3>
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                累计 {summary.totalCount} 次
              </span>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              <span className="font-medium text-text-main">{event.provider}/{event.model}</span>
              {" · "}上游 400 → 429{event.connectionId ? ` · 连接 ${event.connectionId}` : ""}
            </p>
            <p className="mt-1 text-xs text-text-subtle">
              最近发生于 {readableTime}；客户端现在会收到正确的 429 限流状态。终端可搜索
              {" "}<code className="font-mono text-warning">RATE_LIMIT_NORMALIZED</code>。
            </p>
          </div>
        </div>
        <span className="shrink-0 self-start rounded-lg border border-success/20 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success sm:self-center">
          修正规则已生效
        </span>
      </div>
    </Card>
  );
}
