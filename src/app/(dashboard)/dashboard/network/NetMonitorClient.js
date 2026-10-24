"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Badge, Button, Card, CardSkeleton, Modal, SegmentedControl } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import {
  POLL_INTERVAL_MS, PERIODS, tooltipStyle, axisTick, pivotSeries, SERIES_COLORS,
  formatMs, formatPercent, formatTime, formatAxisTime,
  rttTone, lossTone, overallTone,
  LAYER_LABELS, CONFIDENCE_LABELS, confidenceVariant, summarizeLatest,
} from "./constants.js";

export default function NetMonitorClient() {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState({});
  const [availability, setAvailability] = useState({});
  const [period, setPeriod] = useState("24h");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const [passwordPrompt, setPasswordPrompt] = useState(null);
  const [report, setReport] = useState(null);
  const notify = useNotificationStore();

  const refresh = useCallback(async () => {
    try {
      const [statusRes, actionsRes, historyRes] = await Promise.all([
        fetch("/api/net-monitor/status", { cache: "no-store" }),
        fetch("/api/net-monitor/actions", { cache: "no-store" }),
        fetch(`/api/net-monitor/history?period=${period}`, { cache: "no-store" }),
      ]);
      if (!statusRes.ok) throw new Error("status request failed");
      setStatus(await statusRes.json());
      if (actionsRes.ok) {
        const body = await actionsRes.json();
        setAvailability(Object.fromEntries((body.actions || []).map((a) => [a.id, a])));
      }
      if (historyRes.ok) {
        const body = await historyRes.json();
        setHistory((prev) => ({ ...prev, [period]: body.points || [] }));
      }
      setError(null);
    } catch {
      // Polling failures stay silent after the first load; the stale view is
      // better than a flashing error every 10 seconds.
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    // refresh() is async — every setState it triggers lands after an await, so
    // this does not produce the cascading render the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // Poll while the tab is visible; a backgrounded dashboard has no reason to
  // keep hitting the server (and the collector runs regardless).
  const intervalRef = useRef(null);
  useEffect(() => {
    const start = () => {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const runAction = async (actionId, sudoPassword) => {
    setBusyAction(actionId);
    try {
      const res = await fetch("/api/net-monitor/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionId, sudoPassword }),
      });
      const body = await res.json();
      if (body.ok) {
        notify.success(body.message || "操作完成");
        if (actionId === "exportReport" && body.detail) setReport(body.detail);
        refresh();
      } else if (body.needsPassword) {
        setPasswordPrompt({ action: actionId, label: availability[actionId]?.label || actionId });
      } else {
        notify.error(body.message || body.error || "操作失败");
      }
    } catch {
      notify.error("操作请求失败");
    } finally {
      setBusyAction(null);
    }
  };

  const summary = useMemo(() => summarizeLatest(status?.latest), [status]);
  const points = history[period] || [];
  const collector = status?.collector;
  const attribution = status?.attribution;
  const env = status?.env;

  if (loading && !status) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <span className="material-symbols-outlined text-primary">monitor_heart</span>
            网络监控
          </h2>
          {collector && <CollectorBadge collector={collector} />}
        </div>
        <Button size="sm" variant="ghost" icon="refresh" onClick={refresh} disabled={loading}>
          刷新
        </Button>
      </div>

      {error && <Card className="border-danger/20 p-4 text-sm text-danger">{error}</Card>}

      {!collector?.running && (
        <Card className="border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          采集器未运行。前往「设置」开启网络监控后，历史数据才会开始累积。
        </Card>
      )}

      {/* Two rows rather than one cramped row: 4 compact cards, then the two
          wide ones. A 6-up row squeezed the values to "27…" and "3…", and a
          truncated number is worse than an extra row. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard
          label="连通性"
          value={summary.transportTotal ? `${summary.transportOkCount}/${summary.transportTotal}` : "—"}
          tone={overallTone({
            total: summary.transportTotal,
            okCount: summary.transportOkCount,
          })}
          sub="TCP / DNS 探测"
        />
        <SummaryCard label="延迟" value={formatMs(summary.rttAvgMs)} tone={rttTone(summary.rttAvgMs)} sub="平均" />
        <SummaryCard
          label="ICMP 丢包"
          value={summary.icmpFiltered ? "被过滤" : formatPercent(summary.icmpLossMaxPct)}
          tone={summary.icmpFiltered ? "text-text-muted" : lossTone(summary.icmpLossMaxPct)}
          sub={summary.icmpFiltered ? "TCP 正常，不影响实际使用" : "最差目标"}
        />
        <SummaryCard
          label="VPN"
          value={env?.vpn ? (env.vpn.connected ? "已连接" : "未连接") : "—"}
          tone={env?.vpn?.connected ? "text-success" : env?.vpn?.suspected ? "text-warning" : "text-text-muted"}
          sub={env?.vpn?.via || (env?.vpn?.suspected ? "疑似（未确认）" : "—")}
        />
        <SummaryCard
          label="出口 IP"
          value={env?.egress?.ip || "—"}
          sub={env?.egress?.colo ? `节点 ${env.egress.colo}` : "—"}
          span={2}
          mono
        />
        <SummaryCard
          label="网关"
          value={env?.gateway || "—"}
          sub={env?.interface ? `接口 ${env.interface}` : "—"}
          span={2}
          mono
        />
      </div>

      <AttributionPanel attribution={attribution} />

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">历史趋势</h3>
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <TrendChart
            title="延迟"
            data={points}
            dataKey="rttAvgMs"
            period={period}
            formatter={formatMs}
          />
          <TrendChart
            title="丢包"
            data={points}
            dataKey="lossPct"
            period={period}
            formatter={formatPercent}
          />
          <TrendChart
            title="抖动"
            data={points}
            dataKey="jitterMs"
            period={period}
            formatter={formatMs}
          />
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">排查与恢复</h3>
        <p className="mb-3 text-xs text-text-muted">
          以下操作均不会中断你的网络连接。会改变网络状态的操作（关闭 Wi-Fi、重启网卡等）不在本模块范围内。
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(availability).map(([id, action]) => (
            <Button
              key={id}
              size="sm"
              variant="outline"
              disabled={!action.available || busyAction === id}
              onClick={() => runAction(id)}
              title={action.available ? action.description : action.reason}
            >
              {busyAction === id ? "执行中…" : action.label}
            </Button>
          ))}
        </div>
      </Card>

      {env && <EnvironmentDetails env={env} />}

      <PasswordPrompt
        key={passwordPrompt?.action || "none"}
        prompt={passwordPrompt}
        onCancel={() => setPasswordPrompt(null)}
        onSubmit={(password) => {
          const action = passwordPrompt.action;
          setPasswordPrompt(null);
          runAction(action, password);
        }}
      />

      <ReportModal report={report} onClose={() => setReport(null)} />
    </div>
  );
}

function CollectorBadge({ collector }) {
  if (collector.lastError) {
    return <Badge variant="error" dot>{`采集异常`}</Badge>;
  }
  if (!collector.running) return <Badge variant="default" dot>未启动</Badge>;
  if (collector.degraded) {
    return <Badge variant="warning" dot>{`降级模式（${collector.backend}）`}</Badge>;
  }
  return <Badge variant="success" dot>运行中</Badge>;
}

function SummaryCard({ label, value, sub, tone, span = 1, mono = false }) {
  return (
    <Card className={`p-4 ${span === 2 ? "col-span-2" : ""}`}>
      <p className="text-xs uppercase tracking-wide text-text-muted">{label}</p>
      <p
        className={`mt-1 truncate text-xl font-semibold ${mono ? "font-mono text-base" : ""} ${tone || ""}`}
        title={String(value)}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs text-text-muted">{sub}</p>}
    </Card>
  );
}

function AttributionPanel({ attribution }) {
  if (!attribution) {
    return (
      <Card className="p-4">
        <h3 className="mb-1 text-sm font-semibold">归因结论</h3>
        <p className="text-xs text-text-muted">尚无采集数据，等待首轮探测完成。</p>
      </Card>
    );
  }

  const label = LAYER_LABELS[attribution.layer] || attribution.layer;
  const isUnknown = attribution.layer === "unknown";

  return (
    <Card className={`p-4 ${isUnknown ? "" : "border-warning/30"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">归因结论</h3>
        <Badge variant={isUnknown ? "success" : confidenceVariant(attribution.confidence)}>
          {label}
        </Badge>
        {attribution.pending && <Badge variant="default">待确认（{attribution.streak}/2 轮）</Badge>}
        {!isUnknown && (
          <span className="text-xs text-text-muted">置信度：{CONFIDENCE_LABELS[attribution.confidence] || attribution.confidence}</span>
        )}
      </div>
      <ul className="space-y-1">
        {(attribution.reasons || []).map((reason, i) => (
          <li key={i} className="flex gap-2 text-xs text-text-muted">
            <span className="material-symbols-outlined text-[14px] leading-5">chevron_right</span>
            <span>{reason}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TrendChart({ title, data, dataKey, period, formatter }) {
  const { points, targets } = useMemo(() => pivotSeries(data, dataKey), [data, dataKey]);

  return (
    <div>
      <p className="mb-2 text-xs text-text-muted">{title}</p>
      {points.length ? (
        <>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
                <XAxis
                  dataKey="ts"
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatAxisTime(v, period)}
                  minTickGap={32}
                />
                <YAxis
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tickFormatter={formatter}
                  tickCount={4}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(v) => formatTime(v)}
                  formatter={(value, name) => [formatter(value), name]}
                />
                {targets.map((target, i) => (
                  <Area
                    key={target}
                    type="monotone"
                    dataKey={target}
                    name={target}
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                    fillOpacity={0.08}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {targets.map((target, i) => (
              <span key={target} className="flex items-center gap-1 text-[10px] text-text-muted">
                <span
                  className="inline-block h-0.5 w-3 rounded-full"
                  style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
                />
                {target}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="flex h-[180px] items-center justify-center text-sm text-text-muted">暂无数据</div>
      )}
    </div>
  );
}

function EnvironmentDetails({ env }) {
  const rows = [
    ["系统 DNS", (env.dnsServers || []).join(", ") || "—"],
    ["隧道接口", (env.tunnels || []).map((t) => t.name).join(", ") || "无"],
    ["系统 VPN", (env.systemVpn || []).map((s) => `${s.name}（${s.status}）`).join(", ") || "无"],
    ["Tailscale", env.tailscale ? `${env.tailscale.backendState}${env.tailscale.tailnet ? ` · ${env.tailscale.tailnet}` : ""}` : "未安装或未运行"],
    ["代理控制器", env.clash?.present ? `${env.clash.selected || "未选节点"}（${env.clash.nodeCount} 节点）` : "未启用"],
  ];

  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold">本机环境</h3>
      <dl className="grid gap-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-xs text-text-muted">{label}</dt>
            <dd className="truncate text-sm text-text-main" title={value}>{value}</dd>
          </div>
        ))}
      </dl>
      {env.vpn?.suspected && (
        <p className="mt-3 text-xs text-warning">
          {env.vpn.note}
        </p>
      )}
    </Card>
  );
}

function PasswordPrompt({ prompt, onCancel, onSubmit }) {
  const [password, setPassword] = useState("");

  if (!prompt) return null;

  return (
    <Modal isOpen onClose={onCancel} title={`${prompt.label}：需要 sudo 密码`}>
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          该操作需要管理员权限。密码仅用于本次执行，不会保存。
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && password) onSubmit(password);
          }}
          className="w-full rounded-[10px] border border-border bg-surface-2 px-3 py-2 text-sm text-text-main outline-none focus:border-primary"
          placeholder="sudo 密码"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>取消</Button>
          <Button size="sm" disabled={!password} onClick={() => onSubmit(password)}>执行</Button>
        </div>
      </div>
    </Modal>
  );
}

function ReportModal({ report, onClose }) {
  if (!report) return null;

  const download = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `net-monitor-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal isOpen onClose={onClose} title="诊断报告">
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          已汇总当前探测结果、本机环境与归因结论。
        </p>
        <pre className="max-h-80 overflow-auto rounded-[10px] bg-surface-2 p-3 text-xs text-text-main">
          {JSON.stringify(report, null, 2)}
        </pre>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
          <Button size="sm" onClick={download} icon="download">下载 JSON</Button>
        </div>
      </div>
    </Modal>
  );
}
