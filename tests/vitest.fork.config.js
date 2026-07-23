import baseConfig from "./vitest.config.js";

export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: [
      "unit/chat-fallback-preserves-error.test.js",
      "unit/fork-*.test.js",
      "unit/routing-*.test.js",
      "unit/upstream-error-*.test.js",
    ],
  },
};
