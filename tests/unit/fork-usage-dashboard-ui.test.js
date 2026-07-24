import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");

describe("fork usage dashboard UI", () => {
  it("shows rate-limit correction activity at the top of Usage & Analytics", () => {
    const page = read("src/app/(dashboard)/dashboard/usage/page.js");
    const notice = read("src/app/(dashboard)/dashboard/usage/components/fork/RateLimitNormalizationNotice.js");

    expect(page).toContain('import RateLimitNormalizationNotice from "./components/fork/RateLimitNormalizationNotice"');
    expect(page.indexOf("<RateLimitNormalizationNotice />")).toBeLessThan(page.indexOf("<UsageStats"));
    expect(notice).toContain('fetch("/api/fork/rate-limit-normalizations"');
    expect(notice).toContain("400 → 429");
    expect(notice).toContain("RATE_LIMIT_NORMALIZED");
    expect(notice).toContain("totalCount");
  });

  it("matches the five Chinese charts on the reference project's live dashboard", () => {
    const usageStats = read("src/shared/components/UsageStats.js");
    const charts = read("src/app/(dashboard)/dashboard/usage/components/fork/ForkUsageCharts.js");

    expect(usageStats).toContain('import ForkUsageCharts from "@/app/(dashboard)/dashboard/usage/components/fork/ForkUsageCharts"');
    expect(usageStats).toContain("<ForkUsageCharts period={period} />");
    expect(usageStats).toContain("<UsageChart period={period} />");
    expect(charts).toContain('from "recharts"');
    expect(charts).toContain('/api/fork/usage-dashboard?period=');
    expect(charts).toContain("按模型请求数");
    expect(charts).toContain("请求趋势");
    expect(charts).toContain("Token 分布");
    expect(charts).toContain("平均延迟对比");
    expect(charts).toContain("按 API Key 统计");
    expect(charts).toContain("请求数");
    expect(charts).toContain("错误数");
    expect(charts).toContain("暂无统计数据");
    expect(charts).not.toContain("Requests by Model");
    expect(charts).not.toContain("Provider Token Share");
    expect(charts).not.toContain("Token Composition");
    expect(charts).not.toContain("Usage by API Key");
    expect(charts).toContain("var(--color-primary)");
  });
});
