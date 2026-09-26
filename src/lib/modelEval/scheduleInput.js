// Full validation for a schedule (create, and patch-after-merge). The patch
// route merges the stored row with the request body first, so this stays a
// single shape check instead of a partial-update rules matrix.
import { parseCron } from "./cron.js";
import { normalizeThinkingEfforts } from "./thinkingTargets.js";

export const SCHEDULE_MODES = ["hourly", "daily", "cron"];
const MAX_MODELS = 50;

function validDailyTime(value) {
  return /^([01]?\d|2[0-3]):([0-5]\d)$/.test(String(value || "").trim());
}

// Returns { value } or { error }.
export function sanitizeScheduleInput(body = {}) {
  const name = String(body.name || "").trim();
  if (!name) return { error: "任务名称不能为空" };

  const models = [...new Set((Array.isArray(body.models) ? body.models : []).map((m) => String(m || "").trim()).filter(Boolean))];
  if (models.length === 0) return { error: "请至少选择一个模型" };
  if (models.length > MAX_MODELS) return { error: `单个任务最多 ${MAX_MODELS} 个模型` };

  const promptId = String(body.promptId || "").trim();
  if (!promptId) return { error: "请选择一个 Prompt" };

  const mode = String(body.mode || "");
  if (!SCHEDULE_MODES.includes(mode)) return { error: "调度模式不合法" };

  const thinkingEfforts = normalizeThinkingEfforts(body.thinkingEfforts);
  const value = { name: name.slice(0, 100), models, thinkingEfforts, promptId, mode, enabled: body.enabled !== false };

  if (mode === "daily") {
    if (!validDailyTime(body.dailyTime)) return { error: "时间格式应为 HH:MM" };
    value.dailyTime = String(body.dailyTime).trim();
    value.cronExpr = null;
  } else if (mode === "cron") {
    const expr = String(body.cronExpr || "").trim();
    try {
      parseCron(expr);
    } catch (err) {
      return { error: `Cron 表达式无效：${err.message}` };
    }
    value.cronExpr = expr;
    value.dailyTime = null;
  } else {
    value.dailyTime = null;
    value.cronExpr = null;
  }

  return { value };
}
