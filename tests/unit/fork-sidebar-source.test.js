import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sidebarPath = path.resolve(import.meta.dirname, "../../src/shared/components/Sidebar.js");

describe("fork sidebar update safety", () => {
  it("uses the fork status endpoint and never offers the upstream npm install command", () => {
    const source = fs.readFileSync(sidebarPath, "utf8");

    expect(source).toContain('fetch("/api/fork/status")');
    expect(source).toContain("/dashboard/update-center");
    expect(source).toContain("/dashboard/routing-governance");
    expect(source).not.toContain('fetch("/api/version")');
    expect(source).not.toContain("INSTALL_CMD");
  });
});
