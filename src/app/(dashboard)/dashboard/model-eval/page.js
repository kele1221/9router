"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SegmentedControl } from "@/shared/components";
import TestTab from "./components/TestTab";
import HistoryTab from "./components/HistoryTab";
import LeaderboardTab from "./components/LeaderboardTab";
import ModelPreviewsPage from "./components/ModelPreviewsPage";
import ScheduleTab from "./components/ScheduleTab";

const TABS = [
  { value: "test", label: "测试", icon: "play_circle" },
  { value: "history", label: "历史", icon: "history" },
  { value: "leaderboard", label: "排行榜", icon: "leaderboard" },
  { value: "schedule", label: "定时任务", icon: "schedule" },
];

export default function ModelEvalPage() {
  const [tab, setTab] = useState("test");
  const [prompts, setPrompts] = useState([]);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [run, setRun] = useState(null);
  const [results, setResults] = useState([]);
  const [notice, setNotice] = useState(null);
  const [previewModel, setPreviewModel] = useState("");
  const noticeTimer = useRef(null);

  const showNotice = useCallback((message) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  const loadPrompts = useCallback(async () => {
    const res = await fetch("/api/model-eval/prompts", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "加载 Prompt 失败");
    setPrompts(data.prompts || []);
  }, []);

  const refreshRun = useCallback(async (runId) => {
    try {
      const res = await fetch(`/api/model-eval/runs/${runId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setRun(data.run);
      setResults(data.results || []);
    } catch {}
  }, []);

  // Every load below sets state from a promise callback (never synchronously in
  // the effect body) and is guarded against unmount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/model-eval/prompts", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setPrompts(data.prompts || []); })
      .catch(() => { if (!cancelled) showNotice("加载 Prompt 失败"); });

    // The picker itself also hides models of disabled connections; filtering here
    // keeps them out of every section on the page.
    fetch("/api/providers", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setActiveProviders((data.connections || []).filter((c) => c?.isActive !== false));
      })
      .catch(() => { if (!cancelled) showNotice("加载供应商列表失败"); });

    fetch("/api/models/alias", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data) setModelAliases(data.aliases || {}); })
      .catch(() => {});

    // Adopt a run that is already in flight (page reload mid-evaluation).
    fetch("/api/model-eval/runs?limit=1", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.active?.run) return;
        setRun(data.active.run);
        setResults(data.active.results || []);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [showNotice]);

  const reloadPrompts = useCallback(() => {
    loadPrompts().catch(() => showNotice("加载 Prompt 失败"));
  }, [loadPrompts, showNotice]);

  useEffect(() => {
    if (!run || run.status !== "running") return undefined;
    const timer = setInterval(() => refreshRun(run.id), 2000);
    return () => clearInterval(timer);
  }, [run, refreshRun]);

  const startRun = useCallback(async ({ models: selected, promptId }) => {
    try {
      const res = await fetch("/api/model-eval/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: selected, promptId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotice(data.error || "启动评测失败");
        return false;
      }
      setRun(data.run);
      setResults([]);
      setTab("test");
      await refreshRun(data.run.id);
      return true;
    } catch (err) {
      showNotice(err.message);
      return false;
    }
  }, [refreshRun, showNotice]);

  const cancelRun = useCallback(async () => {
    if (!run) return;
    const res = await fetch(`/api/model-eval/runs/${run.id}/cancel`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showNotice(data.error || "取消失败");
      return;
    }
    showNotice("已取消，等待当前请求结束");
    await refreshRun(run.id);
  }, [run, refreshRun, showNotice]);

  const saveScore = useCallback(async (resultId, payload) => {
    const res = await fetch(`/api/model-eval/results/${resultId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showNotice(data.error || "保存评分失败");
      return false;
    }
    setResults((prev) => prev.map((r) => (r.id === resultId ? data.result : r)));
    return true;
  }, [showNotice]);

  const busy = run?.status === "running";

  const retryResults = useCallback(async (resultIds) => {
    if (!run) return false;
    const res = await fetch(`/api/model-eval/runs/${run.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultIds }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showNotice(data.error || "重试失败");
      return false;
    }
    showNotice(`已重新排队 ${data.retried} 个模型`);
    await refreshRun(run.id);
    return true;
  }, [run, refreshRun, showNotice]);

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <div className="rounded-[10px] border border-brand-500/30 bg-brand-500/10 px-4 py-2 text-sm text-text-main">
          {notice}
        </div>
      )}

      {previewModel ? (
        <ModelPreviewsPage model={previewModel} onBack={() => setPreviewModel("")} showNotice={showNotice} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-text-main flex items-center gap-2">
                <span className="material-symbols-outlined text-[26px] text-primary">science</span>
                模型能力测试
              </h1>
              <p className="text-sm text-text-muted mt-1">
                用同一组可视化代码 Prompt 批量跑模型，内嵌渲染各自生成的 HTML，人工打分对比。
              </p>
            </div>
            <SegmentedControl options={TABS} value={tab} onChange={setTab} />
          </div>

          {tab === "test" && (
        <TestTab
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          prompts={prompts}
          run={run}
          results={results}
          busy={busy}
          onStart={startRun}
          onCancel={cancelRun}
          onScore={saveScore}
          onRetry={retryResults}
          onPromptsChanged={reloadPrompts}
          showNotice={showNotice}
        />
      )}

          {tab === "history" && (
        <HistoryTab
          onOpenRun={(target) => {
            setRun(target.run);
            setResults(target.results || []);
            setTab("test");
          }}
          onScore={saveScore}
          showNotice={showNotice}
        />
      )}

          {tab === "leaderboard" && (
            <LeaderboardTab onOpenModelPreviews={setPreviewModel} showNotice={showNotice} />
          )}

          {tab === "schedule" && (
        <ScheduleTab
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          prompts={prompts}
          onRunStarted={async (startedRun) => {
            setRun(startedRun);
            setResults([]);
            setTab("test");
            await refreshRun(startedRun.id);
          }}
          showNotice={showNotice}
        />
      )}
        </>
      )}
    </div>
  );
}
