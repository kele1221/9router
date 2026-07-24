import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-rate-limit-events-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("rate-limit normalization event history", () => {
  it("persists a safe summary of 400 to 429 corrections", async () => {
    const eventStore = await import("../../src/lib/fork/rateLimitNormalization.js");

    await eventStore.recordRateLimitNormalization({
      provider: "dashscope",
      model: "glm-5.2",
      connectionId: "connection-secret-value",
      originalStatus: 400,
      normalizedStatus: 429,
      occurredAt: "2026-07-24T01:00:00.000Z",
      bodyText: "must not be stored",
    });

    const summary = await eventStore.getRateLimitNormalizationSummary();

    expect(summary.totalCount).toBe(1);
    expect(summary.lastEvent).toEqual({
      provider: "dashscope",
      model: "glm-5.2",
      connectionId: "connection...",
      originalStatus: 400,
      normalizedStatus: 429,
      occurredAt: "2026-07-24T01:00:00.000Z",
    });
    expect(summary.recentEvents).toEqual([summary.lastEvent]);
    expect(JSON.stringify(summary)).not.toContain("must not be stored");
  });

  it("keeps only the 20 most recent corrections while preserving the total", async () => {
    const eventStore = await import("../../src/lib/fork/rateLimitNormalization.js");

    for (let index = 0; index < 25; index += 1) {
      await eventStore.recordRateLimitNormalization({
        provider: "provider",
        model: `model-${index}`,
        originalStatus: 400,
        normalizedStatus: 429,
        occurredAt: new Date(Date.UTC(2026, 6, 24, 1, 0, index)).toISOString(),
      });
    }

    const summary = await eventStore.getRateLimitNormalizationSummary();

    expect(summary.totalCount).toBe(25);
    expect(summary.recentEvents).toHaveLength(20);
    expect(summary.recentEvents[0].model).toBe("model-24");
    expect(summary.recentEvents.at(-1).model).toBe("model-5");
  });
});
