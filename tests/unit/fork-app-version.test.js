import { describe, expect, it } from "vitest";
import { APP_CONFIG } from "../../src/shared/constants/config.js";
import { FORK_CONFIG } from "../../src/shared/constants/fork.js";

describe("fork application identity", () => {
  it("shows the fork release version instead of the upstream package version", () => {
    expect(APP_CONFIG.version).toBe(FORK_CONFIG.version);
    expect(APP_CONFIG.name).toContain("Fork");
  });
});
