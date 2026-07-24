import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dashboardPagePath = path.resolve(
  import.meta.dirname,
  "../../src/app/(dashboard)/dashboard/page.js",
);

describe("fork dashboard home", () => {
  it("opens Usage & Analytics as the dashboard home", () => {
    const source = fs.readFileSync(dashboardPagePath, "utf8");

    expect(source).toContain('import { redirect } from "next/navigation"');
    expect(source).toContain('redirect("/dashboard/usage")');
    expect(source).not.toContain("EndpointPageClient");
  });
});
