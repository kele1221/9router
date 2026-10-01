import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowsDir = path.resolve(import.meta.dirname, "../../.github/workflows");
const read = (name) => fs.readFileSync(path.join(workflowsDir, name), "utf8");

describe("fork maintenance workflows", () => {
  it("tests product changes without privileged repository writes", () => {
    const source = read("fork-ci.yml");
    expect(source).toContain("branches: [product]");
    expect(source).toContain("contents: read");
    expect(source).toContain("--ignore-scripts");
    expect(source).toContain("npm run test:fork --prefix tests");
    expect(source).toContain("npm run build");
  });

  it("opens a reviewed upstream sync PR and never auto-merges", () => {
    const source = read("upstream-sync.yml");
    expect(source).toContain('cron: "17 */6 * * *"');
    expect(source).toContain("sync/upstream");
    expect(source).toContain("gh pr create");
    expect(source).toContain("--add-assignee kele1221");
    expect(source).not.toContain("gh pr merge");
    expect(source).toContain("--ignore-scripts");
    expect(source).toContain("upstream/master:refs/heads/master");
  });

  it("only publishes reviewed fork tags", () => {
    const source = read("fork-release.yml");
    expect(source).toContain('"fork-v*"');
    expect(source).toContain("gh release create");
    expect(source).not.toContain("npm publish");
  });

  it("uses a dedicated workflow-write credential for both Git pushes and PR creation", () => {
    const prepare = read("upstream-sync.yml").split("\n  validate:")[0];
    expect(prepare).toContain("token: ${{ secrets.UPSTREAM_SYNC_TOKEN }}");
    expect(prepare).toContain("GH_TOKEN: ${{ secrets.UPSTREAM_SYNC_TOKEN }}");
    expect(prepare).not.toContain("github.token");
    expect(prepare.indexOf("Check upstream sync credential")).toBeLessThan(
      prepare.indexOf("uses: actions/checkout@v4")
    );
    expect(prepare).toContain('if [ -z "$GH_TOKEN" ]; then');
    expect(prepare).toContain("::error::Missing UPSTREAM_SYNC_TOKEN");
    expect(prepare).toContain("exit 1");
  });

  it("prevents inherited upstream deployment jobs from running in this fork", () => {
    expect(read("docker-publish.yml")).toContain("github.repository == 'decolua/9router'");
    expect(read("gitbook-pages.yml")).toContain("github.repository == 'decolua/9router'");
  });
});
