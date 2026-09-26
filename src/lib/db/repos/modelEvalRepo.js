// Model capability evaluation (模型能力测试) — prompts, runs, results, schedules.
// All rows are local-only; scores are human-entered, markers are regex-derived.
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { validatePromptEvaluation } from "../../modelEval/arithmetic.js";

const nowIso = () => new Date().toISOString();

// ─── Prompts (user-defined only; built-ins are code constants) ───

function promptFromRow(row) {
  const evaluationType = row.evaluationType === "arithmetic" ? "arithmetic" : "visual";
  return { id: row.id, name: row.name, content: row.content, evaluationType, expectedAnswer: evaluationType === "arithmetic" ? row.expectedAnswer : null, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function getEvalPrompts() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM modelEvalPrompts ORDER BY createdAt ASC`).map(promptFromRow);
}

export async function getEvalPromptById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM modelEvalPrompts WHERE id = ?`, [id]);
  return row ? promptFromRow(row) : null;
}

export async function createEvalPrompt({ name, content, evaluationType = "visual", expectedAnswer = null }) {
  const db = await getAdapter();
  const ts = nowIso();
  const evaluation = validatePromptEvaluation({ evaluationType, expectedAnswer });
  if (evaluation.error) throw new Error(evaluation.error);
  const row = { id: uuidv4(), name: String(name).trim(), content: String(content), ...evaluation.value, createdAt: ts, updatedAt: ts };
  db.run(`INSERT INTO modelEvalPrompts(id, name, content, evaluationType, expectedAnswer, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.name, row.content, row.evaluationType, row.expectedAnswer, row.createdAt, row.updatedAt]);
  return row;
}

export async function updateEvalPrompt(id, patch) {
  const db = await getAdapter();
  const existing = await getEvalPromptById(id);
  if (!existing) return null;
  const evaluation = validatePromptEvaluation({
    evaluationType: patch.evaluationType !== undefined ? patch.evaluationType : existing.evaluationType,
    expectedAnswer: patch.expectedAnswer !== undefined ? patch.expectedAnswer : existing.expectedAnswer,
  });
  if (evaluation.error) throw new Error(evaluation.error);
  const next = {
    name: patch.name !== undefined ? String(patch.name).trim() || existing.name : existing.name,
    content: patch.content !== undefined ? String(patch.content) : existing.content,
    ...evaluation.value,
    updatedAt: nowIso(),
  };
  db.run(`UPDATE modelEvalPrompts SET name = ?, content = ?, evaluationType = ?, expectedAnswer = ?, updatedAt = ? WHERE id = ?`,
    [next.name, next.content, next.evaluationType, next.expectedAnswer, next.updatedAt, id]);
  return { ...existing, ...next };
}

// Built-in prompts live in code, but a user edit is stored as a row that reuses
// the built-in id, so `getEvalPrompts()` can overlay it and deleting the row
// restores the shipped wording.
export async function upsertEvalPromptOverride({ id, name, content, evaluationType = "visual", expectedAnswer = null }) {
  const db = await getAdapter();
  const existing = await getEvalPromptById(id);
  const ts = nowIso();
  const evaluation = validatePromptEvaluation({ evaluationType, expectedAnswer });
  if (evaluation.error) throw new Error(evaluation.error);
  const row = {
    id,
    name: String(name).trim(),
    content: String(content),
    ...evaluation.value,
    createdAt: existing?.createdAt || ts,
    updatedAt: ts,
  };
  db.run(`INSERT INTO modelEvalPrompts(id, name, content, evaluationType, expectedAnswer, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, content = excluded.content, evaluationType = excluded.evaluationType, expectedAnswer = excluded.expectedAnswer, updatedAt = excluded.updatedAt`,
    [row.id, row.name, row.content, row.evaluationType, row.expectedAnswer, row.createdAt, row.updatedAt]);
  return row;
}

export async function deleteEvalPrompt(id) {
  const db = await getAdapter();
  db.run(`DELETE FROM modelEvalPrompts WHERE id = ?`, [id]);
  return true;
}

// ─── Runs ───

function runFromRow(row) {
  const evaluationType = row.evaluationType === "arithmetic" ? "arithmetic" : "visual";
  return {
    id: row.id,
    promptId: row.promptId,
    promptName: row.promptName,
    promptContent: row.promptContent,
    evaluationType,
    expectedAnswer: evaluationType === "arithmetic" ? row.expectedAnswer : null,
    source: row.source,
    scheduleId: row.scheduleId,
    models: parseJson(row.models, []) || [],
    thinkingEfforts: parseJson(row.thinkingEfforts, ["none"]) || ["none"],
    status: row.status,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export async function createEvalRun({ promptId, promptName, promptContent, evaluationType = "visual", expectedAnswer = null, source, scheduleId, models, thinkingEfforts = ["none"] }) {
  const db = await getAdapter();
  const evaluation = validatePromptEvaluation({ evaluationType, expectedAnswer });
  if (evaluation.error) throw new Error(evaluation.error);
  const row = {
    id: uuidv4(),
    promptId: promptId || null,
    promptName: promptName || null,
    promptContent: String(promptContent || ""),
    ...evaluation.value,
    source: source || "manual",
    scheduleId: scheduleId || null,
    models: JSON.stringify(models || []),
    thinkingEfforts: JSON.stringify(thinkingEfforts || ["none"]),
    status: "running",
    error: null,
    startedAt: nowIso(),
    finishedAt: null,
  };
  db.run(`INSERT INTO modelEvalRuns(id, promptId, promptName, promptContent, evaluationType, expectedAnswer, source, scheduleId, models, thinkingEfforts, status, error, startedAt, finishedAt)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.promptId, row.promptName, row.promptContent, row.evaluationType, row.expectedAnswer, row.source, row.scheduleId, row.models, row.thinkingEfforts, row.status, row.error, row.startedAt, row.finishedAt]);
  return runFromRow(row);
}

export async function updateEvalRun(id, patch) {
  const db = await getAdapter();
  const existing = await getEvalRunById(id);
  if (!existing) return null;
  const next = {
    status: patch.status !== undefined ? patch.status : existing.status,
    error: patch.error !== undefined ? patch.error : existing.error,
    finishedAt: patch.finishedAt !== undefined ? patch.finishedAt : existing.finishedAt,
  };
  db.run(`UPDATE modelEvalRuns SET status = ?, error = ?, finishedAt = ? WHERE id = ?`,
    [next.status, next.error, next.finishedAt, id]);
  return { ...existing, ...next };
}

export async function getEvalRunById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM modelEvalRuns WHERE id = ?`, [id]);
  return row ? runFromRow(row) : null;
}

export async function getEvalRuns({ limit = 50 } = {}) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM modelEvalRuns ORDER BY startedAt DESC LIMIT ?`, [limit]).map(runFromRow);
}

export async function deleteEvalRun(id) {
  const db = await getAdapter();
  db.transaction(() => {
    db.run(`DELETE FROM modelEvalResults WHERE runId = ?`, [id]);
    db.run(`DELETE FROM modelEvalRuns WHERE id = ?`, [id]);
  });
  return true;
}

// ─── Results ───

function resultFromRow(row) {
  return {
    id: row.id,
    runId: row.runId,
    model: row.model,
    provider: row.provider,
    thinkingEffort: row.thinkingEffort || "none",
    status: row.status,
    code: row.code,
    rawText: row.rawText,
    finishReason: row.finishReason,
    markers: parseJson(row.markers, null),
    usage: parseJson(row.usage, null),
    filePath: row.filePath,
    latencyMs: row.latencyMs,
    error: row.error,
    humanScore: row.humanScore,
    humanNote: row.humanNote,
    scoreUpdatedAt: row.scoreUpdatedAt,
    autoEvaluation: parseJson(row.autoEvaluation, null),
    createdAt: row.createdAt,
  };
}

export async function createEvalResult({ runId, model, provider, thinkingEffort = "none", status = "pending" }) {
  const db = await getAdapter();
  const row = {
    id: uuidv4(),
    runId,
    model,
    provider: provider || null,
    thinkingEffort,
    status,
    createdAt: nowIso(),
  };
  db.run(`INSERT INTO modelEvalResults(id, runId, model, provider, thinkingEffort, status, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.runId, row.model, row.provider, row.thinkingEffort, row.status, row.createdAt]);
  return resultFromRow({ ...row, code: null, rawText: null, filePath: null, finishReason: null, markers: null, usage: null, latencyMs: null, error: null, humanScore: null, humanNote: null, scoreUpdatedAt: null, autoEvaluation: null });
}

export async function updateEvalResult(id, patch) {
  const db = await getAdapter();
  const existing = await getEvalResultById(id);
  if (!existing) return null;
  const next = {
    status: patch.status !== undefined ? patch.status : existing.status,
    code: patch.code !== undefined ? patch.code : existing.code,
    rawText: patch.rawText !== undefined ? patch.rawText : existing.rawText,
    filePath: patch.filePath !== undefined ? patch.filePath : existing.filePath,
    finishReason: patch.finishReason !== undefined ? patch.finishReason : existing.finishReason,
    markers: patch.markers !== undefined ? patch.markers : existing.markers,
    usage: patch.usage !== undefined ? patch.usage : existing.usage,
    latencyMs: patch.latencyMs !== undefined ? patch.latencyMs : existing.latencyMs,
    error: patch.error !== undefined ? patch.error : existing.error,
    humanScore: patch.humanScore !== undefined ? patch.humanScore : existing.humanScore,
    humanNote: patch.humanNote !== undefined ? patch.humanNote : existing.humanNote,
    scoreUpdatedAt: patch.scoreUpdatedAt !== undefined ? patch.scoreUpdatedAt : existing.scoreUpdatedAt,
    autoEvaluation: patch.autoEvaluation !== undefined ? patch.autoEvaluation : existing.autoEvaluation,
  };
  db.run(`UPDATE modelEvalResults SET status = ?, code = ?, rawText = ?, filePath = ?, finishReason = ?, markers = ?, usage = ?,
          latencyMs = ?, error = ?, humanScore = ?, humanNote = ?, scoreUpdatedAt = ?, autoEvaluation = ? WHERE id = ?`,
    [next.status, next.code, next.rawText, next.filePath, next.finishReason, stringifyJson(next.markers), stringifyJson(next.usage),
      next.latencyMs, next.error, next.humanScore, next.humanNote, next.scoreUpdatedAt, stringifyJson(next.autoEvaluation), id]);
  return { ...existing, ...next };
}

export async function getEvalResultById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM modelEvalResults WHERE id = ?`, [id]);
  return row ? resultFromRow(row) : null;
}

export async function getEvalResultsByRun(runId) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM modelEvalResults WHERE runId = ? ORDER BY createdAt ASC`, [runId]).map(resultFromRow);
}

// Every stored generation for one model, newest run first — backs the
// leaderboard's per-model preview browser. Arithmetic rows include their text
// answer because they have no generated source to preview.
export async function getEvalResultsByModel(model, { limit = 100, offset = 0 } = {}) {
  const db = await getAdapter();
  const capped = Math.min(Math.max(Number(limit) || 100, 1), 501);
  const skipped = Math.max(Number(offset) || 0, 0);
  const rows = db.all(
    `SELECT r.id, r.runId, r.model, r.provider, r.thinkingEffort, r.status, r.code, r.rawText, r.markers, r.filePath, r.autoEvaluation,
            r.latencyMs, r.error, r.humanScore, r.humanNote, r.createdAt,
            u.promptId, u.promptName, u.source, u.startedAt, u.evaluationType, u.expectedAnswer
     FROM modelEvalResults r JOIN modelEvalRuns u ON u.id = r.runId
     WHERE r.model = ?
     ORDER BY u.startedAt DESC, r.createdAt DESC
     LIMIT ? OFFSET ?`,
    [model, capped, skipped]
  );
  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    model: row.model,
    provider: row.provider,
    thinkingEffort: row.thinkingEffort || "none",
    status: row.status,
    code: row.code,
    markers: parseJson(row.markers, null),
    rawText: row.rawText,
    autoEvaluation: parseJson(row.autoEvaluation, null),
    filePath: row.filePath,
    latencyMs: row.latencyMs,
    error: row.error,
    humanScore: row.humanScore,
    humanNote: row.humanNote,
    createdAt: row.createdAt,
    promptId: row.promptId,
    promptName: row.promptName,
    source: row.source,
    startedAt: row.startedAt,
    evaluationType: row.evaluationType === "arithmetic" ? "arithmetic" : "visual",
    expectedAnswer: row.evaluationType === "arithmetic" ? row.expectedAnswer : null,
  }));
}

export async function setEvalResultScore(id, { humanScore, humanNote }) {
  const db = await getAdapter();
  const existing = await getEvalResultById(id);
  if (!existing) return null;
  const score = humanScore === null || humanScore === undefined || humanScore === "" ? null : Number(humanScore);
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
    throw new Error("Score must be between 0 and 100");
  }
  db.run(`UPDATE modelEvalResults SET humanScore = ?, humanNote = ?, scoreUpdatedAt = ? WHERE id = ?`,
    [score === null ? null : Math.round(score), humanNote ?? null, nowIso(), id]);
  return getEvalResultById(id);
}

// Scored + marker rows for leaderboard aggregation (joined with run time),
// optionally narrowed to a single model and/or a start timestamp.
export async function getEvalScoreRows({ since = null, model = null } = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (since) { where.push(`u.startedAt >= ?`); params.push(since); }
  if (model) { where.push(`r.model = ?`); params.push(model); }
  const sql = `SELECT r.model, r.status, r.markers, r.autoEvaluation, r.humanScore, r.humanNote, r.latencyMs, r.createdAt, u.startedAt, u.evaluationType
               FROM modelEvalResults r JOIN modelEvalRuns u ON u.id = r.runId
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;
  return db.all(sql, params).map((row) => ({
    model: row.model,
    status: row.status,
    markers: parseJson(row.markers, null),
    autoEvaluation: parseJson(row.autoEvaluation, null),
    evaluationType: row.evaluationType === "arithmetic" ? "arithmetic" : "visual",
    humanScore: row.humanScore,
    humanNote: row.humanNote,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
  }));
}

// ─── Schedules ───

function scheduleFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    models: parseJson(row.models, []) || [],
    thinkingEfforts: parseJson(row.thinkingEfforts, ["none"]) || ["none"],
    promptId: row.promptId,
    mode: row.mode,
    dailyTime: row.dailyTime,
    cronExpr: row.cronExpr,
    enabled: row.enabled === 1,
    lastRunAt: row.lastRunAt,
    lastRunId: row.lastRunId,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getEvalSchedules() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM modelEvalSchedules ORDER BY createdAt ASC`).map(scheduleFromRow);
}

export async function getEvalScheduleById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM modelEvalSchedules WHERE id = ?`, [id]);
  return row ? scheduleFromRow(row) : null;
}

export async function createEvalSchedule(data) {
  const db = await getAdapter();
  const ts = nowIso();
  const row = {
    id: uuidv4(),
    name: String(data.name || "未命名任务").trim(),
    models: data.models || [],
    thinkingEfforts: data.thinkingEfforts || ["none"],
    promptId: data.promptId,
    mode: data.mode || "daily",
    dailyTime: data.dailyTime || "09:00",
    cronExpr: data.cronExpr || null,
    enabled: data.enabled === false ? 0 : 1,
    createdAt: ts,
    updatedAt: ts,
  };
  db.run(`INSERT INTO modelEvalSchedules(id, name, models, thinkingEfforts, promptId, mode, dailyTime, cronExpr, enabled, createdAt, updatedAt)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.name, stringifyJson(row.models), stringifyJson(row.thinkingEfforts), row.promptId, row.mode, row.dailyTime, row.cronExpr, row.enabled, row.createdAt, row.updatedAt]);
  return scheduleFromRow({ ...row, lastRunAt: null, lastRunId: null, lastError: null });
}

export async function updateEvalSchedule(id, patch) {
  const db = await getAdapter();
  const existing = await getEvalScheduleById(id);
  if (!existing) return null;
  const next = {
    name: patch.name !== undefined ? String(patch.name).trim() || existing.name : existing.name,
    models: patch.models !== undefined ? patch.models : existing.models,
    thinkingEfforts: patch.thinkingEfforts !== undefined ? patch.thinkingEfforts : existing.thinkingEfforts,
    promptId: patch.promptId !== undefined ? patch.promptId : existing.promptId,
    mode: patch.mode !== undefined ? patch.mode : existing.mode,
    dailyTime: patch.dailyTime !== undefined ? patch.dailyTime : existing.dailyTime,
    cronExpr: patch.cronExpr !== undefined ? patch.cronExpr : existing.cronExpr,
    enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
    lastRunAt: patch.lastRunAt !== undefined ? patch.lastRunAt : existing.lastRunAt,
    lastRunId: patch.lastRunId !== undefined ? patch.lastRunId : existing.lastRunId,
    lastError: patch.lastError !== undefined ? patch.lastError : existing.lastError,
    updatedAt: nowIso(),
  };
  db.run(`UPDATE modelEvalSchedules SET name = ?, models = ?, thinkingEfforts = ?, promptId = ?, mode = ?, dailyTime = ?, cronExpr = ?,
          enabled = ?, lastRunAt = ?, lastRunId = ?, lastError = ?, updatedAt = ? WHERE id = ?`,
    [next.name, stringifyJson(next.models), stringifyJson(next.thinkingEfforts), next.promptId, next.mode, next.dailyTime, next.cronExpr, next.enabled,
      next.lastRunAt, next.lastRunId, next.lastError, next.updatedAt, id]);
  return { ...existing, ...next, enabled: next.enabled === 1 };
}

export async function deleteEvalSchedule(id) {
  const db = await getAdapter();
  db.run(`DELETE FROM modelEvalSchedules WHERE id = ?`, [id]);
  return true;
}
