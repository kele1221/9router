// Evaluation loop for one run. One run at a time process-wide; inside a run the
// providers are evaluated in parallel and each provider's models run one after
// another, so one slow gateway no longer holds up the others without hammering
// a single upstream account.
import {
  createEvalRun, createEvalResult, getEvalResultsByRun, getEvalRunById, getEvalRuns, updateEvalResult, updateEvalRun,
} from "@/lib/db/index.js";
import { getInternalBaseUrl, getInternalHeaders } from "@/lib/internalApi.js";
import { extractCode } from "./extractHtml.js";
import { detectMarkers } from "./markers.js";
import { writeResultFile } from "./outputDir.js";
import { evaluateArithmeticAnswer, validatePromptEvaluation } from "./arithmetic.js";

// Hard cap per model, and the silence budget while it streams. Cap too tight and
// slow-but-alive models get reported as timeouts; the idle budget is what cuts a
// wedged upstream early without punishing a model that keeps producing output.
// Env overrides: MODEL_EVAL_REQUEST_TIMEOUT_MS, MODEL_EVAL_IDLE_TIMEOUT_MS.
export const REQUEST_TIMEOUT_MS = envMs("MODEL_EVAL_REQUEST_TIMEOUT_MS", 15 * 60 * 1000);
export const IDLE_TIMEOUT_MS = envMs("MODEL_EVAL_IDLE_TIMEOUT_MS", 5 * 60 * 1000);
// Reasoning models spend output tokens on thinking before they write anything, so
// a budget sized for the answer alone (8192) came back as "reasoning only".
export const MAX_TOKENS = envMs("MODEL_EVAL_MAX_TOKENS", 16384);

function envMs(name, def) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : def;
}

const state = global.__modelEvalRunner || (global.__modelEvalRunner = {
  active: null, // { runId, canceled, controllers, startedAt }
});

export function getActiveRun() {
  if (!state.active?.runId) return null;
  return {
    runId: state.active.runId,
    canceled: state.active.canceled,
    startedAt: state.active.startedAt,
  };
}

export function isBusy() {
  return Boolean(state.active);
}

export class RunBusyError extends Error {
  constructor() {
    super("An evaluation run is already in progress");
    this.name = "RunBusyError";
  }
}

function normalizeContent(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  return "";
}

// A model that answers with thinking only and burned the whole budget on it was
// truncated, not broken — say so instead of the generic "reasoning only".
function reasoningOnlyError({ finishReason, reasoning, content }) {
  if (finishReason === "length" && !content?.trim()) {
    return `Model spent the whole ${MAX_TOKENS}-token budget on reasoning (finish_reason=length); raise MODEL_EVAL_MAX_TOKENS or lower thinking for this provider`;
  }
  return reasoning ? "Model returned reasoning only (no code)" : "Model returned empty content";
}

function abortMessage(reason) {
  if (reason?.message === "idle timeout") {
    return `No output for ${Math.round(IDLE_TIMEOUT_MS / 1000)}s, aborted`;
  }
  return `Request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s`;
}

// Non-stream fail-open fallback for providers that answer a stream:true request
// with a whole JSON completion. Returns { content, finishReason, usage, error }.
function parseCompletion(parsed, { allowEmptyContent = false } = {}) {
  if (parsed?.error) {
    const detail = parsed.error?.message || parsed.error;
    return { error: String(detail).slice(0, 500) };
  }
  const choice = parsed?.choices?.[0];
  if (!choice) return { error: "Provider returned no completion choices" };

  const content = normalizeContent(choice.message);
  const finishReason = choice.finish_reason || null;
  if (!content.trim() && !allowEmptyContent) {
    const reasoningOnly = choice.message?.reasoning || choice.message?.reasoning_content;
    return {
      finishReason,
      usage: parsed?.usage || null,
      error: reasoningOnlyError({ finishReason, reasoning: reasoningOnly, content }),
    };
  }
  return { content, finishReason, usage: parsed?.usage || null };
}

function parseSseEvent(event) {
  const data = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");
  if (!data || data === "[DONE]") return null;
  try { return JSON.parse(data); } catch { return null; }
}

async function errorDetail(res) {
  const rawText = await res.text().catch(() => "");
  let parsed = null;
  try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}
  const detail = parsed?.error?.message || parsed?.error || parsed?.msg || rawText;
  return detail ? String(detail).slice(0, 500) : "";
}

// Streams the completion: gateways that buffer or stall a whole non-stream
// generation instead deliver deltas, and each chunk re-arms the idle timer.
// Returns { content, finishReason, usage, error }
async function callModel({ model, prompt, thinkingEffort, signal, armIdle, allowEmptyContent = false }) {
  armIdle();
  const res = await fetch(`${getInternalBaseUrl()}/api/v1/chat/completions`, {
    method: "POST",
    headers: await getInternalHeaders(),
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: MAX_TOKENS,
      reasoning_effort: thinkingEffort,
      stream: true,
    }),
    signal,
  });

  if (!res.ok) {
    const detail = await errorDetail(res);
    return { error: `HTTP ${res.status}${detail ? `: ${detail}` : ""}` };
  }

  const streaming = (res.headers.get("content-type") || "").includes("text/event-stream");
  if (!streaming) return parseCompletion(await res.json().catch(() => null), { allowEmptyContent });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let finishReason = null;
  let usage = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    armIdle();
    buffer += decoder.decode(value, { stream: true });

    let separator;
    while ((separator = buffer.indexOf("\n\n")) !== -1) {
      const event = parseSseEvent(buffer.slice(0, separator));
      buffer = buffer.slice(separator + 2);
      if (!event) continue;
      if (event.error) {
        const detail = event.error?.message || event.error;
        return { error: String(detail).slice(0, 500) };
      }
      const choice = event.choices?.[0];
      content += choice?.delta?.content || "";
      reasoning += choice?.delta?.reasoning_content || choice?.delta?.reasoning || "";
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (event.usage) usage = event.usage;
    }
  }

  if (!content.trim() && !allowEmptyContent) {
    return {
      finishReason,
      usage,
      error: reasoningOnlyError({ finishReason, reasoning, content }),
    };
  }
  return { content, finishReason, usage };
}

async function runOneModel({ resultId, model, thinkingEffort, prompt, promptName, evaluationType, expectedAnswer }) {
  const controller = new AbortController();
  state.active?.controllers.add(controller);
  const timeoutId = setTimeout(() => controller.abort(new Error("total timeout")), REQUEST_TIMEOUT_MS);
  let idleId = null;
  const armIdle = () => {
    clearTimeout(idleId);
    idleId = setTimeout(() => controller.abort(new Error("idle timeout")), IDLE_TIMEOUT_MS);
  };
  const startedAt = Date.now();

  try {
    // Visible through the dashboard's 2s poll: without it a multi-minute model
    // looks like the run never started.
    await updateEvalResult(resultId, { status: "running" });
    const outcome = await callModel({ model, prompt, thinkingEffort, signal: controller.signal, armIdle, allowEmptyContent: evaluationType === "arithmetic" });
    const latencyMs = Date.now() - startedAt;

    if (outcome.error) {
      return updateEvalResult(resultId, {
        status: "error",
        latencyMs,
        finishReason: outcome.finishReason || null,
        usage: outcome.usage,
        error: outcome.error,
        markers: evaluationType === "arithmetic" ? null : detectMarkers("", { finishReason: outcome.finishReason }),
      });
    }

    if (evaluationType === "arithmetic") {
      return updateEvalResult(resultId, {
        status: "ok",
        code: null,
        rawText: outcome.content.slice(0, 20000),
        filePath: null,
        latencyMs,
        finishReason: outcome.finishReason || null,
        usage: outcome.usage,
        error: null,
        markers: null,
        autoEvaluation: evaluateArithmeticAnswer({ expectedAnswer, actualAnswer: outcome.content }),
      });
    }

    const code = extractCode(outcome.content);
    if (!code) {
      return updateEvalResult(resultId, {
        status: "error",
        latencyMs,
        finishReason: outcome.finishReason || null,
        usage: outcome.usage,
        error: "未能从输出中提取 HTML/SVG",
        rawText: outcome.content.slice(0, 20000),
        markers: detectMarkers(outcome.content, { finishReason: outcome.finishReason }),
      });
    }

    // Durable copy on disk for the user to open directly; failure is non-fatal.
    const filePath = writeResultFile({ model, promptName, thinkingEffort, code });

    return updateEvalResult(resultId, {
      status: "ok",
      code,
      rawText: null,
      filePath,
      latencyMs,
      finishReason: outcome.finishReason || null,
      usage: outcome.usage,
      error: null,
      markers: detectMarkers(code, { finishReason: outcome.finishReason }),
      autoEvaluation: null,
    });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const aborted = err?.name === "AbortError" || controller.signal.aborted;
    const canceled = state.active?.canceled;
    if (aborted && canceled) return null; // caller marks remaining rows as canceled
    return updateEvalResult(resultId, {
      status: aborted ? "timeout" : "error",
      latencyMs,
      error: aborted ? abortMessage(controller.signal.reason) : String(err?.message || err).slice(0, 500),
      markers: evaluationType === "arithmetic" ? null : detectMarkers(""),
    });
  } finally {
    clearTimeout(timeoutId);
    clearTimeout(idleId);
    state.active?.controllers.delete(controller);
  }
}

async function loop({ runId, models, prompt, promptName, evaluationType, expectedAnswer }) {
  const groups = new Map();
  for (const target of models) {
    const provider = String(target.model).split("/")[0] || "";
    groups.set(provider, [...(groups.get(provider) || []), target]);
  }
  const runGroup = async (group) => {
    for (const target of group) {
      if (state.active?.canceled) return;
      await runOneModel({ ...target, prompt, promptName, evaluationType, expectedAnswer });
    }
  };
  try {
    await Promise.all([...groups.values()].map(runGroup));
  } catch (err) {
    console.error("[ModelEval] run loop failed:", err?.message);
  } finally {
    const canceled = Boolean(state.active?.canceled);
    if (canceled) {
      const rows = await getEvalResultsByRun(runId).catch(() => []);
      for (const row of rows) {
        if (row.status === "pending" || row.status === "running") {
          await updateEvalResult(row.id, { status: "canceled", error: "Canceled" }).catch(() => {});
        }
      }
    }
    const rows = await getEvalResultsByRun(runId).catch(() => []);
    const failed = rows.filter((r) => r.status !== "ok" && r.status !== "canceled").length;
    const status = canceled ? "canceled" : failed === rows.length && rows.length > 0 ? "failed" : "done";
    await updateEvalRun(runId, {
      status,
      finishedAt: new Date().toISOString(),
      error: canceled ? "Canceled by user" : null,
    }).catch(() => {});
    state.active = null;
  }
}

// Creates the run row (plus one pending result row per model) and starts the loop.
export async function startRun({ promptId, promptName, promptContent, evaluationType = "visual", expectedAnswer = null, source, scheduleId, models, thinkingEfforts = ["none"], targets = null }) {
  if (state.active) throw new RunBusyError();
  const evaluation = validatePromptEvaluation({ evaluationType, expectedAnswer });
  if (evaluation.error) throw new Error(evaluation.error);

  // Slot is reserved before the first await: two concurrent POSTs must not both
  // pass the busy check and start a second loop.
  state.active = { runId: null, canceled: false, controllers: new Set(), startedAt: new Date().toISOString() };
  let run;
  const requestedTargets = targets || models.flatMap((model) => thinkingEfforts.map((thinkingEffort) => ({ model, thinkingEffort })));
  const queuedTargets = [];
  try {
    run = await createEvalRun({ promptId, promptName, promptContent, ...evaluation.value, source, scheduleId, models, thinkingEfforts });
    for (const target of requestedTargets) {
      const { model, thinkingEffort } = target;
      const provider = String(model).split("/")[0] || null;
      const result = await createEvalResult({ runId: run.id, model, provider, thinkingEffort });
      queuedTargets.push({ resultId: result.id, model, thinkingEffort });
    }
  } catch (err) {
    state.active = null;
    throw err;
  }

  state.active.runId = run.id;
  state.active.startedAt = run.startedAt;
  // Detached on purpose: the HTTP request returns immediately, the page polls.
  loop({ runId: run.id, models: queuedTargets, prompt: promptContent, promptName, ...evaluation.value }).catch((err) => {
    console.error("[ModelEval] loop crashed:", err?.message);
    state.active = null;
  });
  return run;
}

// Re-runs rows of an existing run in place: failed/timeout models by default, or
// the given resultIds. The run slot is reserved the same way startRun does it,
// and loop() recomputes the run's status from every row when it finishes.
export async function retryResults({ runId, resultIds = null }) {
  if (state.active) throw new RunBusyError();
  const run = await getEvalRunById(runId);
  if (!run) return null;

  const rows = await getEvalResultsByRun(runId);
  const targets = rows.filter((row) => {
    if (row.status === "pending" || row.status === "running") return false;
    return resultIds?.length ? resultIds.includes(row.id) : row.status !== "ok";
  });
  if (!targets.length) return { retried: 0 };

  state.active = { runId, canceled: false, controllers: new Set(), startedAt: new Date().toISOString() };
  try {
    for (const row of targets) {
      await updateEvalResult(row.id, {
        status: "pending", code: null, rawText: null, filePath: null,
        latencyMs: null, finishReason: null, markers: null, usage: null, error: null, autoEvaluation: null,
      });
    }
    await updateEvalRun(runId, { status: "running", error: null, finishedAt: null });
  } catch (err) {
    state.active = null;
    throw err;
  }

  loop({
    runId,
    models: targets.map((row) => ({ resultId: row.id, model: row.model, thinkingEffort: row.thinkingEffort || "none" })),
    prompt: run.promptContent,
    promptName: run.promptName,
    evaluationType: run.evaluationType,
    expectedAnswer: run.expectedAnswer,
  }).catch((err) => {
    console.error("[ModelEval] retry loop crashed:", err?.message);
    state.active = null;
  });
  return { retried: targets.length };
}

// A run only exists inside this process, so a restart leaves its row "running"
// forever — which keeps the dashboard's start button disabled. Close those out
// once at boot, before any new run can start.
export async function markInterruptedRuns() {
  const runs = await getEvalRuns({ limit: 200 }).catch(() => []);
  for (const run of runs) {
    if (run.status !== "running" || run.id === state.active?.runId) continue;
    const rows = await getEvalResultsByRun(run.id).catch(() => []);
    for (const row of rows) {
      if (row.status === "pending" || row.status === "running") {
        await updateEvalResult(row.id, { status: "canceled", error: "Interrupted by restart" }).catch(() => {});
      }
    }
    await updateEvalRun(run.id, {
      status: "failed",
      error: "Interrupted by server restart",
      finishedAt: new Date().toISOString(),
    }).catch(() => {});
  }
}

export async function cancelRun(runId) {
  if (!state.active || state.active.runId !== runId) return false;
  state.active.canceled = true;
  // Every model that is currently in flight, not just one.
  for (const controller of state.active.controllers) {
    try { controller.abort(new Error("canceled")); } catch {}
  }
  return true;
}
