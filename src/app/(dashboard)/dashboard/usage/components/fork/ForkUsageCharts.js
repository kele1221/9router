"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
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
import { buildUsageAnalytics } from "@/lib/fork/usageAnalytics.js";

const CHART_COLORS = [
  "var(--color-primary)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-brand-300)",
  "var(--color-text-muted)",
];
const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const tooltipStyle = {
  backgroundColor: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  color: "var(--color-text-main)",
  fontSize: 12,
};
const axisTick = { fill: "var(--color-text-muted)", fontSize: 11 };

function ChartFrame({ title, subtitle, hasData, children }) {
  return (
    <Card padding="sm" className="min-w-0" title={title} subtitle={subtitle}>
      {hasData ? children : (
        <div className="flex h-[250px] items-center justify-center text-sm text-text-muted">
          No data for this period
        </div>
      )}
    </Card>
  );
}

ChartFrame.propTypes = {
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.string,
  hasData: PropTypes.bool.isRequired,
  children: PropTypes.node.isRequired,
};

export default function ForkUsageCharts({ period }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);

    fetch(`/api/usage/stats?period=${encodeURIComponent(period)}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Usage stats request failed: ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (active) setStats(data);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [period]);

  const analytics = useMemo(() => buildUsageAnalytics(stats, { limit: 6 }), [stats]);

  if (loading) {
    return (
      <Card padding="sm" className="flex min-h-36 items-center justify-center text-sm text-text-muted">
        <span className="material-symbols-outlined mr-2 animate-spin text-[18px]">progress_activity</span>
        Loading additional analytics...
      </Card>
    );
  }

  if (failed) {
    return (
      <Card padding="sm" className="border-danger/20 text-sm text-danger">
        Failed to load additional analytics.
      </Card>
    );
  }

  return (
    <section className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Additional usage analytics">
      <ChartFrame
        title="Requests by Model"
        subtitle="Top models in the selected period"
        hasData={analytics.modelRequests.length > 0}
      >
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={analytics.modelRequests} layout="vertical" margin={{ top: 4, right: 18, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--color-border-subtle)" horizontal={false} />
            <XAxis type="number" tick={axisTick} tickFormatter={(value) => compactNumber.format(value)} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={105} tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [Number(value).toLocaleString(), "Requests"]} />
            <Bar dataKey="requests" fill="var(--color-primary)" radius={[0, 6, 6, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Provider Token Share"
        subtitle="Input and output tokens grouped by provider"
        hasData={analytics.providerTokens.length > 0}
      >
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={analytics.providerTokens} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>
              {analytics.providerTokens.map((item, index) => (
                <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [compactNumber.format(value), "Tokens"]} />
            <Legend wrapperStyle={{ color: "var(--color-text-muted)", fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Token Composition"
        subtitle="Cached input is separated to avoid double counting"
        hasData={analytics.tokenComposition.length > 0}
      >
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={analytics.tokenComposition} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>
              {analytics.tokenComposition.map((item, index) => (
                <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [compactNumber.format(value), "Tokens"]} />
            <Legend wrapperStyle={{ color: "var(--color-text-muted)", fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Usage by API Key"
        subtitle="Requests aggregated across models"
        hasData={analytics.apiKeyUsage.length > 0}
      >
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={analytics.apiKeyUsage} layout="vertical" margin={{ top: 4, right: 18, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--color-border-subtle)" horizontal={false} />
            <XAxis type="number" tick={axisTick} tickFormatter={(value) => compactNumber.format(value)} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={105} tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [Number(value).toLocaleString(), name === "requests" ? "Requests" : "Tokens"]} />
            <Bar dataKey="requests" fill="var(--color-info)" radius={[0, 6, 6, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </section>
  );
}

ForkUsageCharts.propTypes = {
  period: PropTypes.string.isRequired,
};
