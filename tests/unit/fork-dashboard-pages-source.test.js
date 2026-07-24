import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dashboardDir = path.resolve(import.meta.dirname, "../../src/app/(dashboard)/dashboard");

describe("fork dashboard pages", () => {
  it("provides a fork-aware update center", () => {
    const source = fs.readFileSync(path.join(dashboardDir, "update-center/page.js"), "utf8");

    expect(source).toContain('forceRefresh ? "?refresh=1" : ""');
    expect(source).toContain('loadStatus(false)');
    expect(source).toContain('loadStatus(true)');
    expect(source).toContain("暂无法检查");
    expect(source).toContain("官方上游");
    expect(source).toContain("Fork Release");
    expect(source).toContain("同步 PR");
  });

  it("provides routing topology, normalization rules, verification, and docs", () => {
    const source = fs.readFileSync(path.join(dashboardDir, "routing-governance/page.js"), "utf8");

    expect(source).toContain("实际调用链路");
    expect(source).toContain("响应归一化规则");
    expect(source).toContain("配置验证");
    expect(source).toContain("运行文档");
  });
});
