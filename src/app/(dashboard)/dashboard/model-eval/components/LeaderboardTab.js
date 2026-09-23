"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Card, SegmentedControl, Select } from "@/shared/components";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const PERIODS = [
  { value: "all", label: "全部" },
  { value: "today", label: "今日" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
];

const TREND_DAYS = [7, 14, 30].map((d) => ({ value: String(d), label: `近 ${d} 天` }));
const pct = (value) => (value === null || value === undefined ? "—" : `${value}%`);

export default function LeaderboardTab({ onOpenModelPreviews, showNotice }) {
  const [period, setPeriod] = useState("all");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [trendModel, setTrendModel] = useState("");
  const [trendDays, setTrendDays] = useState("14");
  const [trend, setTrend] = useState(null);
  const [sort, setSort] = useState({ key: "avgScore", direction: "desc" });

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ period });
    if (trendModel) {
      params.set("trendModel", trendModel);
      params.set("trendDays", trendDays);
    }
    fetch(`/api/model-eval/leaderboard?${params}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setRows(data.leaderboard || []);
        setTrend(data.trend || null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        showNotice?.("加载排行榜失败");
      });
    return () => { cancelled = true; };
  }, [period, trendModel, trendDays, showNotice]);

  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const leftValue = sort.key === "model" ? left.model : left[sort.key];
    const rightValue = sort.key === "model" ? right.model : right[sort.key];
    if (leftValue === null || leftValue === undefined) return rightValue === null || rightValue === undefined ? 0 : 1;
    if (rightValue === null || rightValue === undefined) return -1;
    const comparison = typeof leftValue === "string"
      ? leftValue.localeCompare(rightValue, "zh-CN")
      : leftValue - rightValue;
    return sort.direction === "asc" ? comparison : -comparison;
  }), [rows, sort]);

  const changeSort = (key) => {
    setSort((current) => (
      current.key === key
        ? { ...current, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "model" || key === "lastAt" ? "asc" : "desc" }
    ));
  };

  const SortHeader = ({ column, children, align = "left" }) => {
    const active = sort.key === column;
    return (
      <th className={`py-2 pr-3 ${align === "right" ? "text-right" : "text-left"}`} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => changeSort(column)}
          className={`inline-flex items-center gap-1 hover:text-text-main focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 ${align === "right" ? "justify-end" : "justify-start"}`}
        >
          {children}
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
            {active ? (sort.direction === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="模型能力排行榜"
        subtitle="按人工评分平均分排序；未评分的模型排在末尾，自动标记仅作参考。"
        icon="leaderboard"
        padding="sm"
        action={<SegmentedControl size="sm" options={PERIODS} value={period} onChange={setPeriod} />}
      >
        {loading && <p className="text-sm text-text-muted">加载中…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-text-muted">该时间段还没有评测数据。</p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-text-muted">
                  <th className="text-left py-2 pr-3">#</th>
                  <SortHeader column="model">模型</SortHeader>
                  <SortHeader column="avgScore" align="right">平均分</SortHeader>
                  <SortHeader column="scoreCount" align="right">评分数</SortHeader>
                  <SortHeader column="okRate" align="right">成功率</SortHeader>
                  <SortHeader column="svgRate" align="right">含 SVG</SortHeader>
                  <SortHeader column="animRate" align="right">含动画</SortHeader>
                  <SortHeader column="avgLatencyMs" align="right">平均耗时</SortHeader>
                  <SortHeader column="lastAt">最近评测</SortHeader>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, index) => (
                  <tr
                    key={row.model}
                    onClick={() => setTrendModel(row.model === trendModel ? "" : row.model)}
                    className="border-t border-border-subtle/60 cursor-pointer hover:bg-surface-2"
                    title="点击行查看该模型的按天走势"
                  >
                    <td className="py-2 pr-3 text-text-muted">{index + 1}</td>
                    <td className="py-2 pr-3 max-w-[240px]">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenModelPreviews(row.model);
                        }}
                        className="block max-w-full truncate text-left text-text-main hover:text-brand-500 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30"
                        title={`查看 ${row.model} 的历史 HTML 预览`}
                      >
                        {row.model}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-text-main">{row.avgScore ?? "—"}</td>
                    <td className="py-2 pr-3 text-right text-text-muted">{row.scoreCount}/{row.evaluations}</td>
                    <td className="py-2 pr-3 text-right text-text-muted">{pct(row.okRate)}</td>
                    <td className="py-2 pr-3 text-right text-text-muted">{pct(row.svgRate)}</td>
                    <td className="py-2 pr-3 text-right text-text-muted">{pct(row.animRate)}</td>
                    <td className="py-2 pr-3 text-right text-text-muted">{row.avgLatencyMs ? `${(row.avgLatencyMs / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="py-2 text-text-muted">{row.lastAt ? new Date(row.lastAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {trendModel && (
        <Card
          title={`${trendModel} 评分走势`}
          subtitle="按天平均人工分；没有人工评分的日期为空点。"
          icon="trending_up"
          padding="sm"
          action={<Select value={trendDays} onChange={(e) => setTrendDays(e.target.value)} options={TREND_DAYS} className="w-32" />}
        >
          {trend?.points?.length ? (
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend.points} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="dateKey" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value, name) => [value ?? "未评分", name === "avgScore" ? "平均分" : name]}
                    labelFormatter={(label) => `日期 ${label}`}
                  />
                  <Line type="monotone" dataKey="avgScore" stroke="#6366f1" strokeWidth={2} connectNulls dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-text-muted">该模型近 {trendDays} 天没有记录。</p>
          )}
        </Card>
      )}

    </div>
  );
}

LeaderboardTab.propTypes = {
  onOpenModelPreviews: PropTypes.func.isRequired,
  showNotice: PropTypes.func,
};
