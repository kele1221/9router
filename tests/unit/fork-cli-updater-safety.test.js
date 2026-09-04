import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cliDir = path.resolve(import.meta.dirname, "../../cli");

describe("fork CLI updater safety", () => {
  it("identifies the fork build and suppresses the official npm updater", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf8"));
    const source = fs.readFileSync(path.join(cliDir, "cli.js"), "utf8");

    expect(pkg.forkVersion).toBe("0.5.65-k.14");
    expect(pkg.scripts["pack:cli"]).toContain("--pack-destination ..");
    expect(pkg.scripts["pack:cli"]).not.toContain("--pack-destination ../..");
    expect(source).toContain("const DISPLAY_VERSION = pkg.forkVersion || pkg.version;");
    expect(source).toContain("if (skipUpdate || IS_FORK)");
    expect(source).not.toContain("INSTALL_CMD_LATEST");
  });
});
