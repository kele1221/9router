// Runner loop behaviour: the in-flight model shows up as "running" (the page
// polls every 2s), a streaming reply is assembled into a stored file, providers
// run in parallel while a provider's own models stay serial, silence and a
// never-ending stream end as "timeout" instead of a hanging row, and failed
// rows can be retried in place.
// DATA_DIR / output dir / timeouts must be set before the modules load.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-model-eval-runner-"));
process.env.DATA_DIR = path.join(tmpDir, "data");
process.env.MODEL_EVAL_OUTPUT_DIR = path.join(tmpDir, "out");
process.env.MODEL_EVAL_REQUEST_TIMEOUT_MS = "1500";
process.env.MODEL_EVAL_IDLE_TIMEOUT_MS = "250";
process.env.MODEL_EVAL_MAX_TOKENS = "4096";

let repo;
let runner;

beforeAll(async () => {
  repo = await import("../../src/lib/db/repos/modelEvalRepo.js");
  runner = await import("../../src/lib/modelEval/runner.js");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function waitFor(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const startOne = (model) => runner.startRun({
  promptId: "builtin:pelican-svg-bike",
  promptName: "SVG 鹈鹕骑自行车动画",
  promptContent: "画一只鹈鹕",
  source: "manual",
  scheduleId: null,
  models: [model],
});

// Serves an SSE body made of whatever frames the body pushes; an aborted request
// errors the stream, which is what the runner's reader sees on timeout.
function sseFetch(onStart) {
  return (url, options) => new Promise((resolve) => {
    const stream = new ReadableStream({
      start(controller) {
        const send = (frame) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`));
        options?.signal?.addEventListener("abort", () => controller.error(options.signal.reason ?? new Error("aborted")));
        onStart({ send, close: () => controller.close() });
      },
    });
    resolve(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
  });
}

const htmlFrame = { choices: [{ delta: { content: "```html\n<h1>pelican</h1>\n```" } }] };
const doneFrame = { choices: [{ delta: {}, finish_reason: "stop" }], usage: { completion_tokens: 12 } };

const settle = (row) => (row.status === "pending" || row.status === "running" ? null : row);
const firstResult = async (runId) => waitFor(async () => {
  const rows = await repo.getEvalResultsByRun(runId);
  return rows[0] ? settle(rows[0]) : null;
});

describe("model eval runner", () => {
  it("reads the per-model timeouts from the environment", () => {
    expect(runner.REQUEST_TIMEOUT_MS).toBe(1500);
    expect(runner.IDLE_TIMEOUT_MS).toBe(250);
    expect(runner.MAX_TOKENS).toBe(4096);
  });

  it("runs different providers in parallel and one model at a time per provider", async () => {
    const originalFetch = global.fetch;
    let inFlight = 0;
    let peak = 0;
    const perProvider = {};
    const peakPerProvider = {};
    global.fetch = async (url, options) => {
      const model = JSON.parse(options.body).model;
      const provider = String(model).split("/")[0];
      inFlight++;
      peak = Math.max(peak, inFlight);
      perProvider[provider] = (perProvider[provider] || 0) + 1;
      peakPerProvider[provider] = Math.max(peakPerProvider[provider] || 0, perProvider[provider]);
      await new Promise((resolve) => setTimeout(resolve, 60));
      inFlight--;
      perProvider[provider]--;
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "<svg><rect/></svg>" }, finish_reason: "stop" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const run = await runner.startRun({
        promptId: "builtin:pelican-svg-bike", promptName: "并发", promptContent: "画一只鹈鹕",
        source: "manual", scheduleId: null, models: ["p1/a", "p1/b", "p2/c"],
      });
      await waitFor(async () => (await repo.getEvalRunById(run.id)).status === "done");
      expect(peak).toBe(2);
      expect(peakPerProvider).toEqual({ p1: 1, p2: 1 });
      await waitFor(async () => !runner.isBusy());
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("cancels every in-flight model", async () => {
    const originalFetch = global.fetch;
    global.fetch = (url, options) => new Promise((resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(options.signal.reason ?? new Error("aborted")));
    });
    try {
      const run = await runner.startRun({
        promptId: "builtin:pelican-svg-bike", promptName: "取消", promptContent: "画一只鹈鹕",
        source: "manual", scheduleId: null, models: ["p1/a", "p2/b"],
      });
      await waitFor(async () => {
        const rows = await repo.getEvalResultsByRun(run.id);
        return rows.every((row) => row.status === "running");
      });
      expect(await runner.cancelRun(run.id)).toBe(true);

      const rows = await waitFor(async () => {
        const current = await repo.getEvalResultsByRun(run.id);
        return current.every((row) => row.status === "canceled") ? current : null;
      });
      expect(rows).toHaveLength(2);
      expect((await repo.getEvalRunById(run.id)).status).toBe("canceled");
      await waitFor(async () => !runner.isBusy());
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("marks the in-flight model as running, then stores the streamed output", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const originalFetch = global.fetch;
    const reply = sseFetch(({ send, close }) => { send(htmlFrame); send(doneFrame); close(); });
    global.fetch = async (...args) => { await gate; return reply(...args); };
    try {
      const run = await startOne("t/pelican");
      const running = await waitFor(async () => {
        const { status } = (await repo.getEvalResultsByRun(run.id))[0];
        return status === "running" ? status : null;
      });
      expect(running).toBe("running");

      release();

      const done = await waitFor(async () => {
        const [row] = await repo.getEvalResultsByRun(run.id);
        return row.status === "ok" ? row : null;
      });
      expect(done.code).toContain("<h1>pelican</h1>");
      expect(done.finishReason).toBe("stop");
      expect(done.usage).toEqual({ completion_tokens: 12 });
      expect(fs.existsSync(done.filePath)).toBe(true);
      await waitFor(async () => !runner.isBusy());
    } finally {
      release();
      global.fetch = originalFetch;
    }
  });

  it("still accepts a whole JSON completion from a provider that ignores stream", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "<svg><circle r=\"1\"/></svg>" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
    try {
      const run = await startOne("t/json-only");
      const row = await firstResult(run.id);
      expect(row.status).toBe("ok");
      expect(row.code).toContain("<svg>");
      await waitFor(async () => !runner.isBusy());
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("times out with an idle message when the stream goes silent", async () => {
    const originalFetch = global.fetch;
    global.fetch = sseFetch(({ send }) => send(htmlFrame));
    try {
      const run = await startOne("t/goes-silent");
      const row = await firstResult(run.id);
      expect(row.status).toBe("timeout");
      expect(row.error).toMatch(/No output for/);
      await waitFor(async () => !runner.isBusy());
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("caps a stream that never ends", async () => {
    const originalFetch = global.fetch;
    let heartbeat = null;
    global.fetch = sseFetch(({ send }) => {
      const beat = () => { try { send(htmlFrame); } catch { clearInterval(heartbeat); } };
      beat();
      heartbeat = setInterval(beat, 50);
    });
    try {
      const run = await startOne("t/never-ends");
      const row = await firstResult(run.id);
      expect(row.status).toBe("timeout");
      expect(row.error).toMatch(/timed out after/);
      await waitFor(async () => !runner.isBusy());
    } finally {
      clearInterval(heartbeat);
      global.fetch = originalFetch;
    }
  });

  it("retries failed rows of a finished run in place", async () => {
    const originalFetch = global.fetch;
    const reply = (ok) => new Response(JSON.stringify(ok
      ? { choices: [{ message: { role: "assistant", content: "<svg><circle/></svg>" }, finish_reason: "stop" }] }
      : { choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }], usage: { completion_tokens: 4096 } }
    ), { status: 200, headers: { "content-type": "application/json" } });

    let failModel = true;
    global.fetch = async (url, options) => reply(JSON.parse(options.body).model === "p1/works" || !failModel);
    try {
      const run = await runner.startRun({
        promptId: "builtin:pelican-svg-bike", promptName: "重试", promptContent: "画一只鹈鹕",
        source: "manual", scheduleId: null, models: ["p1/broken", "p1/works"],
      });
      const rows = await waitFor(async () => {
        const current = await repo.getEvalResultsByRun(run.id);
        return current.every((row) => !["pending", "running"].includes(row.status)) ? current : null;
      });
      const broken = rows.find((row) => row.model === "p1/broken");
      expect(broken.status).toBe("error");
      expect(broken.error).toMatch(/budget on reasoning/);

      failModel = false;
      expect(await runner.retryResults({ runId: run.id })).toEqual({ retried: 1 });
      const retried = await waitFor(async () => {
        const row = (await repo.getEvalResultsByRun(run.id)).find((r) => r.model === "p1/broken");
        return row.status === "ok" ? row : null;
      });
      expect(retried.code).toContain("<circle/>");
      await waitFor(async () => (await repo.getEvalRunById(run.id)).status === "done");
      await waitFor(async () => !runner.isBusy());
    } finally {
      global.fetch = originalFetch;
    }
  });
});
