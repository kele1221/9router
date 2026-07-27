"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardSkeleton } from "@/shared/components";

const REPOSITORY = "https://github.com/kele1221/9router/blob/product";

function exportSupportBundle(status) {
  const blob = new Blob([JSON.stringify(status, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `9router-routing-status-${new Date().toISOString().replaceAll(":", "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function RoutingGovernancePage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/fork/routing-governance?refresh=1", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setStatus(payload);
    } catch (loadError) {
      setError(`链路校验失败：${loadError.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (loading && !status) {
    return <div className="grid gap-4"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>;
  }

  const rule = status?.responseRules?.[0];
  const rateLimitMarkers = Array.isArray(rule?.when?.errorCodeOrTypes)
    ? rule.when.errorCodeOrTypes
    : [rule?.when?.errorCodeOrType || "rate_limit_exceeded"];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">链路治理</h1>
          <p className="mt-1 text-sm text-text-muted">把实际端口、供应商节点、响应规则和运维文档放在同一份可校验声明中。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon="download" disabled={!status} onClick={() => exportSupportBundle(status)}>导出脱敏状态</Button>
          <Button variant="secondary" icon="refresh" loading={loading} onClick={loadStatus}>重新验证</Button>
        </div>
      </div>

      {error && <Card className="border-red-500/30 text-sm text-red-600">{error}</Card>}

      <Card title="实际调用链路" subtitle={status?.chain?.name} icon="account_tree">
        <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-center">
          {status?.chain?.hops?.map((hop, index) => (
            <div key={hop.id} className="contents">
              <Card.Section className="min-w-0 flex-1">
                <Badge size="sm" variant={hop.kind === "router" ? "primary" : "default"}>{hop.kind}</Badge>
                <p className="mt-2 font-semibold text-text-main">{hop.name}</p>
                <p className="mt-1 break-all text-xs text-text-muted">{hop.url || hop.baseUrl || hop.description}</p>
              </Card.Section>
              {index < status.chain.hops.length - 1 && <span className="material-symbols-outlined self-center rotate-90 text-text-muted lg:rotate-0">arrow_forward</span>}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="响应归一化规则" icon="rule">
          <div className="rounded-[10px] border border-border-subtle bg-bg p-4 font-mono text-sm text-text-main">
            <p>upstream_status == {rule?.when?.status ?? 400}</p>
            <p>error.code/type ∈ [{rateLimitMarkers.map((marker) => `"${marker}"`).join(", ")}]</p>
            <p className="my-2 text-primary">→ effective_status = {rule?.then?.effectiveStatus ?? 429}</p>
            <p>response_body = unchanged</p>
            <p>ordinary_400 = unchanged</p>
          </div>
          <p className="mt-3 text-xs text-text-muted">该归一化发生在 9Router 进行 cooldown 和模型锁定判断之前。</p>
        </Card>

        <Card title="配置验证" subtitle={status?.configSource === "local" ? "使用 DATA_DIR 私有覆盖" : "正在使用公开模板"} icon="fact_check" action={
          <Badge variant={status?.healthy ? "success" : "error"} dot>{status?.healthy ? "全部通过" : "需要处理"}</Badge>
        }>
          <div className="space-y-1">
            {status?.checks?.map((check) => (
              <Card.Row key={check.id} className="flex items-start justify-between gap-3">
                <div><p className="text-sm font-medium text-text-main">{check.label}</p><p className="mt-0.5 break-all text-xs text-text-muted">{check.detail}</p></div>
                <Badge size="sm" variant={check.status === "pass" ? "success" : "error"}>{check.status === "pass" ? "通过" : "失败"}</Badge>
              </Card.Row>
            ))}
          </div>
        </Card>
      </div>

      <Card title="运行文档" subtitle="文档与配置随 product 分支一起版本化" icon="menu_book">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {status?.documents?.map((document) => (
            <a key={document.id} href={`${REPOSITORY}/${document.path}`} target="_blank" rel="noreferrer" className="rounded-[10px] border border-border-subtle bg-bg p-4 transition-colors hover:border-primary/40">
              <p className="font-semibold text-text-main">{document.title}</p>
              <p className="mt-1 text-xs text-text-muted">{document.description}</p>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
