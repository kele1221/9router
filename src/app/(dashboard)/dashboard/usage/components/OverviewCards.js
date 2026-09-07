"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtTenMillion = (n) => `${((n || 0) / 10_000_000).toFixed(2)} 千万`;
const USD_RATE = 7.3;
const fmtCost = (n) => `¥${((n || 0) * USD_RATE).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 sm:gap-4">
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Total Requests</span>
        <span className="truncate text-2xl font-bold">{fmt(stats.totalRequests)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Total Input Tokens</span>
        <span className="truncate text-2xl font-bold text-primary">{fmtTenMillion(stats.totalPromptTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Cached Tokens</span>
        <span className="truncate text-2xl font-bold text-info">{fmtTenMillion(stats.totalCachedTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">缓存命中率</span>
        <span className="truncate text-2xl font-bold text-accent">
          {stats.totalPromptTokens > 0
            ? (stats.totalCachedTokens / stats.totalPromptTokens * 100).toFixed(1) + "%"
            : "—"}
        </span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm font-semibold">Token 节省率</span>
        <span className="truncate text-2xl font-bold text-success">
          {stats.totalRtkSavedChars > 0
            ? `${(stats.totalRtkSavedChars / (stats.totalRtkSavedChars + (stats.totalRtkAfterChars || 0)) * 100).toFixed(1)}%`
            : "—"}
        </span>
        <span className="text-[10px] text-text-muted">RTK 工具结果压缩估算</span>
        {(stats.totalRtkBudgetRequests || 0) > 0 && (
          <span className="text-[10px] text-text-muted">
            Budget: {fmt(stats.totalRtkBudgetSavedTokens)} est. tokens / {fmt(stats.totalRtkBudgetRequests)} req
          </span>
        )}
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Output Tokens</span>
        <span className="truncate text-2xl font-bold text-success">{fmtTenMillion(stats.totalCompletionTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Est. Cost</span>
        <span className="truncate text-2xl font-bold text-warning">~{fmtCost(stats.totalCost)}</span>
        <span className="text-[10px] text-text-muted">Estimated, not actual billing</span>
      </Card>
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
