// In-process cron tick for scheduled evaluations. Started from instrumentation.js
// so API-only workers (no dashboard render) still fire, same as backgroundTokenRefresh.
// Single-process assumption: one router process owns the schedules.
import { getEvalPromptById, getEvalSchedules, updateEvalSchedule } from "@/lib/db/index.js";
import { findBuiltinPrompt, isBuiltinPromptId } from "@/shared/constants/evalPrompts.js";
import { cronMatches, parseCron } from "./cron.js";
import { RunBusyError, markInterruptedRuns, startRun } from "./runner.js";
import { expandThinkingTargets } from "./thinkingTargets.js";

export const TICK_INTERVAL_MS = 60 * 1000;

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hourBucket = (d) => `${dateKey(d)}T${pad(d.getHours())}`;
const minuteBucket = (d) => `${hourBucket(d)}:${pad(d.getMinutes())}`;

function parseDailyTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

// Does this schedule owe a run right now? Missed windows are not replayed:
// each mode compares the last run against the current bucket, so a process that
// was down fires at most one catch-up run on the next tick.
export function isScheduleDue(schedule, now = new Date()) {
  if (!schedule?.enabled) return false;
  const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null;

  if (schedule.mode === "hourly") {
    if (!lastRun || Number.isNaN(lastRun.getTime())) return true;
    return hourBucket(now) !== hourBucket(lastRun);
  }

  if (schedule.mode === "daily") {
    const time = parseDailyTime(schedule.dailyTime);
    if (!time) return false;
    const dueToday = now.getHours() > time.hours || (now.getHours() === time.hours && now.getMinutes() >= time.minutes);
    if (!dueToday) return false;
    if (lastRun && !Number.isNaN(lastRun.getTime()) && dateKey(lastRun) === dateKey(now)) return false;
    // A schedule created after today's time point waits for tomorrow instead of
    // firing the moment it is saved.
    if (!lastRun) {
      const created = schedule.createdAt ? new Date(schedule.createdAt) : null;
      if (created && !Number.isNaN(created.getTime()) && dateKey(created) === dateKey(now)) {
        return created.getHours() < time.hours || (created.getHours() === time.hours && created.getMinutes() <= time.minutes);
      }
    }
    return true;
  }

  if (schedule.mode === "cron") {
    let parsed;
    try { parsed = parseCron(schedule.cronExpr); } catch { return false; }
    if (!cronMatches(parsed, now)) return false;
    if (!lastRun || Number.isNaN(lastRun.getTime())) return true;
    return minuteBucket(now) !== minuteBucket(lastRun);
  }

  return false;
}

export async function resolvePromptContent(promptId) {
  if (!promptId) return null;
  if (isBuiltinPromptId(promptId)) {
    // A user edit of a built-in prompt is stored under the built-in id.
    const override = await getEvalPromptById(promptId);
    if (override) return { name: override.name, content: override.content, evaluationType: override.evaluationType, expectedAnswer: override.expectedAnswer };
    const builtin = findBuiltinPrompt(promptId);
    return builtin ? { name: builtin.name, content: builtin.content, evaluationType: builtin.evaluationType, expectedAnswer: builtin.expectedAnswer } : null;
  }
  const prompt = await getEvalPromptById(promptId);
  return prompt ? { name: prompt.name, content: prompt.content, evaluationType: prompt.evaluationType, expectedAnswer: prompt.expectedAnswer } : null;
}

async function tick() {
  try {
    const schedules = await getEvalSchedules();
    const now = new Date();
    for (const schedule of schedules) {
      if (!isScheduleDue(schedule, now)) continue;

      // Never records lastRunAt when the prompt is gone, so the schedule keeps
      // retrying the window instead of silently dying.
      if (!schedule.models?.length) continue;
      const prompt = await resolvePromptContent(schedule.promptId);
      if (!prompt) {
        if (schedule.lastError !== "prompt-missing") {
          await updateEvalSchedule(schedule.id, { lastError: "prompt-missing" });
        }
        continue;
      }

      try {
        const { targets } = await expandThinkingTargets(schedule.models, schedule.thinkingEfforts || ["none"]);
        if (!targets.length) {
          await updateEvalSchedule(schedule.id, { lastError: "thinking-level-unsupported" });
          continue;
        }
        const run = await startRun({
          promptId: schedule.promptId,
          promptName: prompt.name,
          promptContent: prompt.content,
          evaluationType: prompt.evaluationType,
          expectedAnswer: prompt.expectedAnswer,
          source: "schedule",
          scheduleId: schedule.id,
          models: schedule.models,
          thinkingEfforts: schedule.thinkingEfforts || ["none"],
          targets,
        });
        await updateEvalSchedule(schedule.id, {
          lastRunAt: now.toISOString(),
          lastRunId: run.id,
          lastError: null,
        });
      } catch (err) {
        if (err instanceof RunBusyError) return; // another run owns the slot; retry next tick
        await updateEvalSchedule(schedule.id, { lastError: String(err?.message || err).slice(0, 200) });
      }
    }
  } catch (err) {
    console.error("[ModelEval] scheduler tick failed:", err?.message);
  }
}

let intervalHandle = null;

export function startModelEvalScheduler() {
  if (intervalHandle) return;
  // Runs left "running" by a restart would block the dashboard's start button
  // forever; close them out before the first tick can fire.
  markInterruptedRuns().catch(() => {});
  intervalHandle = setInterval(() => { tick().catch(() => {}); }, TICK_INTERVAL_MS);
  intervalHandle.unref?.();
  console.log("[ModelEval] scheduler started");
}
