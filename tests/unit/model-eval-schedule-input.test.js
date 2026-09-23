import { describe, expect, it } from "vitest";
import { sanitizeScheduleInput } from "../../src/lib/modelEval/scheduleInput.js";

const base = { name: "巡检", models: ["a/b"], promptId: "builtin:pelican-svg-bike", mode: "hourly" };

describe("schedule input validation", () => {
  it("accepts an hourly task and drops unrelated fields", () => {
    const { value, error } = sanitizeScheduleInput({ ...base, dailyTime: "09:00", cronExpr: "0 * * * *" });
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ name: "巡检", mode: "hourly", dailyTime: null, cronExpr: null, enabled: true });
  });

  it("requires a valid HH:MM for daily tasks", () => {
    expect(sanitizeScheduleInput({ ...base, mode: "daily", dailyTime: "9am" }).error).toMatch(/HH:MM/);
    expect(sanitizeScheduleInput({ ...base, mode: "daily", dailyTime: "24:00" }).error).toMatch(/HH:MM/);
    expect(sanitizeScheduleInput({ ...base, mode: "daily", dailyTime: "07:05" }).value.dailyTime).toBe("07:05");
  });

  it("rejects an invalid cron expression and keeps a valid one", () => {
    expect(sanitizeScheduleInput({ ...base, mode: "cron", cronExpr: "0 * *" }).error).toMatch(/Cron/);
    expect(sanitizeScheduleInput({ ...base, mode: "cron", cronExpr: "*/30 * * * *" }).value.cronExpr).toBe("*/30 * * * *");
  });

  it("requires a name, at least one model and a prompt", () => {
    expect(sanitizeScheduleInput({ ...base, name: "   " }).error).toMatch(/名称/);
    expect(sanitizeScheduleInput({ ...base, models: [] }).error).toMatch(/模型/);
    expect(sanitizeScheduleInput({ ...base, promptId: "" }).error).toMatch(/Prompt/);
    expect(sanitizeScheduleInput({ ...base, mode: "weekly" }).error).toMatch(/调度模式/);
  });

  it("de-duplicates models and honours enabled=false", () => {
    const { value } = sanitizeScheduleInput({ ...base, models: ["a/b", "a/b", " c/d "], enabled: false });
    expect(value.models).toEqual(["a/b", "c/d"]);
    expect(value.enabled).toBe(false);
  });
});
