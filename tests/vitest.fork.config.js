import { sharedTest, resolveConfig, isolatedSetupFiles } from "./vitest.config.js";

// Fork/routing subset, with the same throwaway-DATA_DIR isolation as the
// default project so a fork run can never write the live ~/.9router database.
export default {
  test: {
    projects: [
      {
        resolve: resolveConfig,
        test: {
          ...sharedTest,
          name: "fork",
          include: [
            "unit/chat-fallback-preserves-error.test.js",
            "unit/fork-*.test.js",
            "unit/routing-*.test.js",
            "unit/upstream-error-*.test.js",
          ],
          setupFiles: isolatedSetupFiles,
        },
      },
    ],
  },
};
