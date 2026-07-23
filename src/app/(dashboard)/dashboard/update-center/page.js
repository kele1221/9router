"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardSkeleton } from "@/shared/components";

function StateBadge({ ok, children }) {
  return <Badge variant={ok ? "success" : "warning"} dot>{children}</Badge>;
}

function ExternalLink({ href, children }) {
  if (!href) return <span className="text-sm text-text-muted">暂无</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-sm font-semibold text-primary hover:underline"
    >
      {children}
    </a>
  );
}

export default function UpdateCenterPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/fork/status?refresh=1", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus(await response.json());
    } catch (loadError) {
      setError(`更新状态读取失败：${loadError.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (loading && !status) {
    return <div className="grid gap-4 lg:grid-cols-3"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">Fork 更新中心</h1>
          <p className="mt-1 text-sm text-text-muted">
            上游代码发现、审核同步和本机安装彼此分离；这里不会直接覆盖当前运行版本。
          </p>
        </div>
        <Button variant="secondary" icon="refresh" loading={loading} onClick={loadStatus}>立即检查</Button>
      </div>

      {error && <Card className="border-red-500/30 text-sm text-red-600">{error}</Card>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="官方上游" subtitle={status?.upstream?.repository} icon="source">
          <div className="space-y-3">
            <StateBadge ok={!status?.upstream?.hasUpdate}>
              {status?.upstream?.hasUpdate ? `待评估 ${status.upstream.aheadBy} 个提交` : "已同步"}
            </StateBadge>
            <p className="text-sm text-text-muted">
              只负责感知 decolua/9router 的变化，不自动合并到生产分支。
            </p>
            <ExternalLink href={status?.upstream?.compareUrl}>查看差异</ExternalLink>
          </div>
        </Card>

        <Card title="同步 PR" subtitle="sync/upstream → product" icon="difference">
          <div className="space-y-3">
            <StateBadge ok={status?.sync?.status === "current"}>
              {status?.sync?.status === "pr_open" ? `PR #${status.sync.prNumber} 待审核` :
                status?.sync?.status === "update_available" ? "等待自动创建" : "无需同步"}
            </StateBadge>
            <p className="text-sm text-text-muted">
              自动化只创建候选 PR；测试通过且人工审核后才允许进入产品分支。
            </p>
            <ExternalLink href={status?.sync?.prUrl}>打开同步 PR</ExternalLink>
          </div>
        </Card>

        <Card title="Fork Release" subtitle={status?.fork?.repository} icon="deployed_code">
          <div className="space-y-3">
            <StateBadge ok={!status?.fork?.hasInstallUpdate}>
              {status?.fork?.hasInstallUpdate ? `可安装 ${status.fork.latestVersion}` : `当前 ${status?.currentVersion || "未知"}`}
            </StateBadge>
            <p className="text-sm text-text-muted">
              仅安装经过 CI 和发布审查的 fork-v* 构建，不再调用官方 npm 自更新。
            </p>
            <ExternalLink href={status?.fork?.releaseUrl}>查看发布包</ExternalLink>
          </div>
        </Card>
      </div>

      <Card title="安全边界" icon="verified_user">
        <div className="grid gap-3 text-sm text-text-muted md:grid-cols-3">
          <Card.Section><strong className="text-text-main">1. 发现</strong><p className="mt-1">定时比较官方 master。</p></Card.Section>
          <Card.Section><strong className="text-text-main">2. 审核</strong><p className="mt-1">候选分支跑测试和构建。</p></Card.Section>
          <Card.Section><strong className="text-text-main">3. 发布</strong><p className="mt-1">人工合并并打 fork-v* 标签。</p></Card.Section>
        </div>
        <p className="mt-4 text-xs text-text-muted">最后检查：{status?.checkedAt ? new Date(status.checkedAt).toLocaleString() : "未完成"}</p>
      </Card>
    </div>
  );
}
