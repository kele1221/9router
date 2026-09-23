// Schema + SQL smoke test for the evaluation tables. DATA_DIR must be set
// before the DB modules load, or the adapter would open the user's live DB.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-model-eval-"));
process.env.DATA_DIR = tmpDir;

let repo;

beforeAll(async () => {
  repo = await import("../../src/lib/db/repos/modelEvalRepo.js");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("model eval repository", () => {
  it("creates, updates and deletes a custom prompt", async () => {
    const created = await repo.createEvalPrompt({ name: " 我的用例 ", content: "画一只猫" });
    expect(created.name).toBe("我的用例");

    const updated = await repo.updateEvalPrompt(created.id, { content: "画一只狗" });
    expect(updated.content).toBe("画一只狗");
    expect((await repo.getEvalPrompts())).toHaveLength(1);

    await repo.deleteEvalPrompt(created.id);
    expect(await repo.getEvalPromptById(created.id)).toBeNull();
  });

  it("stores a built-in prompt override under the built-in id and restores on delete", async () => {
    const builtinId = "builtin:pelican-svg-bike";
    const override = await repo.upsertEvalPromptOverride({ id: builtinId, name: "我的鹈鹕", content: "画鹈鹕，翅膀要动" });
    expect(override.id).toBe(builtinId);

    const again = await repo.upsertEvalPromptOverride({ id: builtinId, name: "我的鹈鹕 v2", content: "画鹈鹕，腿也要动" });
    expect(again.name).toBe("我的鹈鹕 v2");
    expect(await repo.getEvalPrompts()).toHaveLength(1);

    await repo.deleteEvalPrompt(builtinId);
    expect(await repo.getEvalPromptById(builtinId)).toBeNull();
    expect(await repo.getEvalPrompts()).toHaveLength(0);
  });

  it("runs a full run lifecycle including human scoring", async () => {
    const run = await repo.createEvalRun({
      promptId: "builtin:pelican-svg-bike",
      promptName: "SVG 鹈鹕骑自行车动画",
      promptContent: "画鹈鹕",
      source: "manual",
      models: ["a/b", "c/d"],
    });
    expect(run.status).toBe("running");
    expect(run.models).toEqual(["a/b", "c/d"]);

    const result = await repo.createEvalResult({ runId: run.id, model: "a/b", provider: "a" });
    expect(result.status).toBe("pending");

    const finished = await repo.updateEvalResult(result.id, {
      status: "ok",
      code: "<svg/>",
      filePath: "/tmp/model-eval-output/a-b-20260923-140509.svg",
      markers: { hasSvg: true, hasAnimation: true, truncated: false, length: 6 },
      usage: { completion_tokens: 42 },
      latencyMs: 1234,
    });
    expect(finished.markers.hasSvg).toBe(true);
    expect(finished.usage.completion_tokens).toBe(42);
    expect(finished.filePath).toBe("/tmp/model-eval-output/a-b-20260923-140509.svg");

    const scored = await repo.setEvalResultScore(result.id, { humanScore: 88, humanNote: "构图不错" });
    expect(scored.humanScore).toBe(88);
    expect(scored.scoreUpdatedAt).toBeTruthy();
    await expect(repo.setEvalResultScore(result.id, { humanScore: 120 })).rejects.toThrow(/0 and 100/);

    await repo.updateEvalRun(run.id, { status: "done", finishedAt: new Date().toISOString() });
    expect((await repo.getEvalRunById(run.id)).status).toBe("done");
    expect(await repo.getEvalResultsByRun(run.id)).toHaveLength(1);

    const rows = await repo.getEvalScoreRows({ model: "a/b" });
    expect(rows).toHaveLength(1);
    expect(rows[0].humanScore).toBe(88);

    await repo.deleteEvalRun(run.id);
    expect(await repo.getEvalRunById(run.id)).toBeNull();
    expect(await repo.getEvalResultsByRun(run.id)).toHaveLength(0);
  });

  it("pages historical results for one model", async () => {
    const run = await repo.createEvalRun({
      promptId: "builtin:pelican-svg-bike",
      promptName: "分页预览",
      promptContent: "画鹈鹕",
      source: "manual",
      models: ["page/model"],
    });
    const results = await Promise.all([0, 1, 2].map(() => repo.createEvalResult({
      runId: run.id,
      model: "page/model",
      provider: "page",
    })));

    const firstPage = await repo.getEvalResultsByModel("page/model", { limit: 2 });
    const secondPage = await repo.getEvalResultsByModel("page/model", { limit: 2, offset: 2 });

    expect(firstPage).toHaveLength(2);
    expect(secondPage).toHaveLength(1);
    expect([...firstPage, ...secondPage].map((result) => result.id).sort()).toEqual(results.map((result) => result.id).sort());

    await repo.deleteEvalRun(run.id);
  });

  it("persists schedules with flags and run pointers", async () => {
    const schedule = await repo.createEvalSchedule({
      name: "每小时巡检",
      models: ["a/b"],
      promptId: "builtin:pelican-svg-bike",
      mode: "cron",
      cronExpr: "0 * * * *",
    });
    expect(schedule.enabled).toBe(true);
    expect(schedule.mode).toBe("cron");

    const toggled = await repo.updateEvalSchedule(schedule.id, { enabled: false, lastRunId: "run-1", lastError: "prompt-missing" });
    expect(toggled.enabled).toBe(false);
    expect(toggled.lastError).toBe("prompt-missing");
    expect((await repo.getEvalSchedules())).toHaveLength(1);

    await repo.deleteEvalSchedule(schedule.id);
    expect(await repo.getEvalScheduleById(schedule.id)).toBeNull();
  });
});
