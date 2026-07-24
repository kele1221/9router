"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Card from "@/shared/components/Card";

const CHART_COLORS = [
  "var(--color-primary)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-brand-300)",
];
const compactNumber = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const tooltipStyle = {
  backgroundColor: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  color: "var(--color-text-main)",
  fontSize: 12,
};
const axisTick = { fill: "var(--color-text-muted)", fontSize: 10 };

function truncateLabel(value, maxLength = 18) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function formatBucketLabel(value, period) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (period === "today" || period === "24h") {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function ChartFrame({ title, subtitle, hasData, wide = false, children }) {
  return (
    <Card
      padding="sm"
      className={`min-w-0 ${wide ? "lg:col-span-2" : ""}`}
      title={title}
      subtitle={subtitle}
    >
      {hasData ? children : (
        <div className="flex h-[280px] items-center justify-center text-sm text-text-muted">
          暂无统计数据
        </div>
      )}
    </Card>
  );
}

ChartFrame.propTypes = {
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.string,
  hasData: PropTypes.bool.isRequired,
  wide: PropTypes.bool,
  children: PropTypes.node.isRequired,
};

export default function ForkUsageCharts({ period }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);

    fetch(`/api/fork/usage-dashboard?period=${encodeURIComponent(period)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`图表数据请求失败：${response.status}`);
        return response.json();
      })
      .then(setData)
      .catch((error) => {
        if (error.name !== "AbortError") setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [period]);

  const modelStats = data?.modelStats || [];
  const requestTrend = data?.requestTrend || [];
  const tokenDistribution = data?.tokenDistribution || [];
  const apiKeyStats = data?.apiKeyStats || [];
  const trendModels = useMemo(
    () => modelStats
      .map((item) => item.model)
      .filter((model) => requestTrend.some((bucket) => Number(bucket[model]) > 0))
      .slice(0, 5),
    [modelStats, requestTrend],
  );
  const latencyStats = modelStats.filter((item) => item.avgLatencyMs > 0);

  if (loading) {
    return (
      <Card padding="sm" className="flex min-h-40 items-center justify-center text-sm text-text-muted">
        <span className="material-symbols-outlined mr-2 animate-spin text-[18px]">progress_activity</span>
        正在加载统计图表…
      </Card>
    );
  }

  if (failed) {
    return (
      <Card padding="sm" className="border-danger/20 text-sm text-danger">
        图表数据加载失败，请稍后重试。
      </Card>
    );
  }

  return (
    <section className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2" aria-label="使用情况统计图表">
      <ChartFrame
        title="按模型请求数"
        subtitle="所选时段内各模型的请求量"
        hasData={modelStats.some((item) => item.totalRequests > 0)}
      >
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={modelStats} margin={{ top: 10, right: 12, bottom: 34, left: 0 }}>
            <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
            <XAxis
              dataKey="model"
              tick={axisTick}
              tickFormatter={(value) => truncateLabel(value)}
              interval={0}
              angle={-12}
              textAnchor="end"
              axisLine={false}
              tickLine={false}
            />
            <YAxis tick={axisTick} allowDecimals={false} axisLine={false} tickLine={false} width={38} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(value) => String(value)}
              formatter={(value) => [Number(value).toLocaleString("zh-CN"), "请求数"]}
            />
            <Bar dataKey="totalRequests" name="请求数" radius={[5, 5, 0, 0]} maxBarSize={52}>
              {modelStats.map((item, index) => (
                <Cell key={item.model} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="请求趋势"
        subtitle="最多展示请求量前 5 个模型"
        hasData={requestTrend.length > 0 && trendModels.length > 0}
      >
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={requestTrend} margin={{ top: 10, right: 12, bottom: 22, left: 0 }}>
            <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
            <XAxis
              dataKey="timestamp"
              tick={axisTick}
              tickFormatter={(value) => formatBucketLabel(value, period)}
              minTickGap={22}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tick={axisTick} allowDecimals={false} axisLine={false} tickLine={false} width={38} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(value) => formatBucketLabel(value, period)}
              formatter={(value, name) => [Number(value).toLocaleString("zh-CN"), name]}
            />
            <Legend wrapperStyle={{ color: "var(--color-text-muted)", fontSize: 10 }} />
            {trendModels.map((model, index) => (
              <Area
                key={model}
                type="monotone"
                dataKey={model}
                name={model}
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
                fillOpacity={0.08}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Token 分布"
        subtitle="输入与输出 Token 合计，按模型分布"
        hasData={tokenDistribution.length > 0}
      >
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={tokenDistribution}
              dataKey="value"
              nameKey="name"
              innerRadius={62}
              outerRadius={94}
              paddingAngle={2}
              stroke="var(--color-surface)"
              strokeWidth={2}
            >
              {tokenDistribution.map((item, index) => (
                <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => [compactNumber.format(Number(value)), "Token"]}
            />
            <Legend wrapperStyle={{ color: "var(--color-text-muted)", fontSize: 10 }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="平均延迟对比"
        subtitle={`基于最近 ${data?.coverage?.requestSamples || 0} 条可用观测记录`}
        hasData={latencyStats.length > 0}
      >
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={latencyStats} layout="vertical" margin={{ top: 10, right: 18, bottom: 10, left: 8 }}>
            <CartesianGrid stroke="var(--color-border-subtle)" horizontal={false} />
            <XAxis
              type="number"
              tick={axisTick}
              tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}秒` : `${value}毫秒`}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="model"
              width={120}
              tick={axisTick}
              tickFormatter={(value) => truncateLabel(value, 20)}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(value) => String(value)}
              formatter={(value) => [`${Number(value).toLocaleString("zh-CN")} 毫秒`, "平均延迟"]}
            />
            <Bar dataKey="avgLatencyMs" name="平均延迟" radius={[0, 5, 5, 0]} maxBarSize={34}>
              {latencyStats.map((item, index) => (
                <Cell key={item.model} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="按 API Key 统计"
        subtitle="请求数与可归属到访问密钥的错误数"
        hasData={apiKeyStats.length > 0}
        wide
      >
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={apiKeyStats} margin={{ top: 10, right: 18, bottom: 28, left: 0 }}>
            <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
            <XAxis
              dataKey="name"
              tick={axisTick}
              tickFormatter={(value) => truncateLabel(value, 22)}
              interval={0}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tick={axisTick} allowDecimals={false} axisLine={false} tickLine={false} width={38} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(value) => String(value)}
              formatter={(value, name) => [Number(value).toLocaleString("zh-CN"), name]}
            />
            <Legend wrapperStyle={{ color: "var(--color-text-muted)", fontSize: 10 }} />
            <Bar dataKey="totalRequests" name="请求数" fill="var(--color-primary)" radius={[5, 5, 0, 0]} maxBarSize={48} />
            <Bar dataKey="totalErrors" name="错误数" fill="var(--color-danger)" radius={[5, 5, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </section>
  );
}

ForkUsageCharts.propTypes = {
  period: PropTypes.string.isRequired,
};
