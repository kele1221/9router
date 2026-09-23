// Runs before every test file in the default vitest project: point DATA_DIR at
// a throwaway temp dir so a test run can never write the live ~/.9router
// database (provider connections, usage, request details all resolve through
// DATA_DIR). Pass DATA_DIR explicitly to override, e.g. to reuse one dir.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.DATA_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-test-data-"));
  process.env.DATA_DIR = dir;
  process.once("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
}
