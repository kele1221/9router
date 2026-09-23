import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
export const TEST_EXCLUDE = ["**/node_modules/**", "**/.claude/**", "**/dist/**"];

// Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
// Inline projects don't inherit root-level resolve, so each project carries a copy.
export const resolveConfig = {
  alias: [
    { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
    { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
    { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
  ],
};

// Shared across projects.
export const sharedTest = {
  environment: "node",
  globals: true,
  // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
  maxConcurrency: 60,
  // Suppress noisy console output from handlers under test
  silent: false,
  exclude: TEST_EXCLUDE,
};

// Throwaway DATA_DIR per test file — see setup/isolatedDataDir.js.
export const isolatedSetupFiles = [resolve(__dirname, "setup/isolatedDataDir.js")];

export default defineConfig({
  test: {
    projects: [
      {
        // Default project: every test file runs against its own throwaway
        // DATA_DIR (see setup/isolatedDataDir.js), so a run can never write
        // the live ~/.9router database (connections, usage, request details).
        resolve: resolveConfig,
        test: {
          ...sharedTest,
          name: "isolated",
          include: ["**/*.test.js"],
          // Don't scan into git worktrees nested under .claude/ — they carry
          // their own copies of the test files but lack an installed
          // node_modules (open-sse, etc.), which makes provider imports fail
          // during collection.
          exclude: [...TEST_EXCLUDE, "**/*.real.test.js"],
          setupFiles: isolatedSetupFiles,
        },
      },
      {
        // Live-provider tests read credentials from the real DATA_DIR on purpose.
        resolve: resolveConfig,
        test: {
          ...sharedTest,
          name: "real",
          include: ["**/*.real.test.js"],
        },
      },
    ],
  },
  resolve: resolveConfig,
});
