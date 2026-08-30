"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import RequestDetailsTab from "./components/RequestDetailsTab";
import RateLimitNormalizationNotice from "./components/fork/RateLimitNormalizationNotice";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();

  const [period, setPeriod] = useState("today");

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    // Next 16.2 route cache returns a stale canonicalUrl for same-path
    // search-param-only navigations after a hard load (vercel/next.js
    // #91658/#92187, fixed in 16.3 via #94144), so router.push leaves the
    // URL/tab stuck. The patched history API still syncs the router.
    window.history.pushState({}, "", `/dashboard/usage?${params.toString()}`);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "details", label: "Details" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        {activeTab === "overview" && (
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            size="sm"
            className="w-full sm:w-auto"
          />
        )}
      </div>

      <RateLimitNormalizationNotice />

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}
    </div>
  );
}
