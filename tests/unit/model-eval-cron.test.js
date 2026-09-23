import { describe, expect, it } from "vitest";
import { cronMatches, parseCron } from "../../src/lib/modelEval/cron.js";
import { isScheduleDue } from "../../src/lib/modelEval/scheduler.js";

const at = (iso) => new Date(iso);
const local = (...args) => new Date(...args);

describe("cron parsing and matching", () => {
  it("rejects malformed expressions", () => {
    expect(() => parseCron("* * * *")).toThrow(/5 fields/);
    expect(() => parseCron("* * * * * *")).toThrow(/5 fields/);
    expect(() => parseCron("70 * * * *")).toThrow(/minute/);
    expect(() => parseCron("*/0 * * * *")).toThrow(/step/);
  });

  it("matches every minute with *", () => {
    expect(cronMatches("* * * * *", at("2026-09-23T10:31:00"))).toBe(true);
  });

  it("matches a fixed minute and hour", () => {
    expect(cronMatches("30 9 * * *", at("2026-09-23T09:30:00"))).toBe(true);
    expect(cronMatches("30 9 * * *", at("2026-09-23T09:31:00"))).toBe(false);
  });

  it("supports steps, ranges and lists", () => {
    expect(cronMatches("*/15 * * * *", at("2026-09-23T10:45:00"))).toBe(true);
    expect(cronMatches("*/15 * * * *", at("2026-09-23T10:46:00"))).toBe(false);
    expect(cronMatches("0 9-11 * * *", at("2026-09-23T10:00:00"))).toBe(true);
    expect(cronMatches("0 9,18 * * *", at("2026-09-23T18:00:00"))).toBe(true);
    expect(cronMatches("0 9,18 * * *", at("2026-09-23T12:00:00"))).toBe(false);
  });

  it("matches weekday ranges (0 = Sunday)", () => {
    // 2026-09-23 is a Wednesday.
    expect(cronMatches("0 9 * * 1-5", at("2026-09-23T09:00:00"))).toBe(true);
    expect(cronMatches("0 9 * * 0", at("2026-09-23T09:00:00"))).toBe(false);
  });

  it("treats restricted day-of-month/day-of-week as OR", () => {
    expect(cronMatches("0 9 23 * 0", at("2026-09-23T09:00:00"))).toBe(true);
    expect(cronMatches("0 9 24 * 0", at("2026-09-23T09:00:00"))).toBe(false);
  });
});

describe("schedule due checks", () => {
  it("ignores disabled schedules", () => {
    expect(isScheduleDue({ enabled: false, mode: "hourly" }, at("2026-09-23T10:00:00"))).toBe(false);
  });

  it("fires hourly once per hour bucket", () => {
    const schedule = { enabled: true, mode: "hourly", lastRunAt: local(2026, 8, 23, 9, 0, 30).toISOString() };
    expect(isScheduleDue(schedule, local(2026, 8, 23, 10, 0, 0))).toBe(true);
    expect(isScheduleDue({ ...schedule, lastRunAt: local(2026, 8, 23, 10, 0, 10).toISOString() }, local(2026, 8, 23, 10, 30, 0))).toBe(false);
  });

  it("fires daily once past the configured time", () => {
    const base = { enabled: true, mode: "daily", dailyTime: "09:30", lastRunAt: null, createdAt: "2026-09-01T00:00:00" };
    expect(isScheduleDue(base, at("2026-09-23T09:29:00"))).toBe(false);
    expect(isScheduleDue(base, at("2026-09-23T09:30:00"))).toBe(true);
    expect(isScheduleDue({ ...base, lastRunAt: local(2026, 8, 23, 9, 30, 5).toISOString() }, local(2026, 8, 23, 18, 0, 0))).toBe(false);
    expect(isScheduleDue({ ...base, lastRunAt: local(2026, 8, 22, 9, 30, 5).toISOString() }, local(2026, 8, 23, 18, 0, 0))).toBe(true);
  });

  it("does not fire a daily schedule created after today's time point", () => {
    const createdLate = { enabled: true, mode: "daily", dailyTime: "09:00", lastRunAt: null, createdAt: new Date(2026, 8, 23, 15, 0, 0).toISOString() };
    expect(isScheduleDue(createdLate, new Date(2026, 8, 23, 15, 5, 0))).toBe(false);
    expect(isScheduleDue(createdLate, new Date(2026, 8, 24, 9, 1, 0))).toBe(true);
  });

  it("rejects an invalid daily time", () => {
    expect(isScheduleDue({ enabled: true, mode: "daily", dailyTime: "25:00", lastRunAt: null }, at("2026-09-23T10:00:00"))).toBe(false);
  });

  it("fires cron schedules at most once per matching minute", () => {
    const schedule = { enabled: true, mode: "cron", cronExpr: "*/5 * * * *", lastRunAt: null };
    expect(isScheduleDue(schedule, at("2026-09-23T10:05:00"))).toBe(true);
    expect(isScheduleDue({ ...schedule, lastRunAt: local(2026, 8, 23, 10, 5, 10).toISOString() }, local(2026, 8, 23, 10, 5, 40))).toBe(false);
  });

  it("never fires an invalid cron expression", () => {
    expect(isScheduleDue({ enabled: true, mode: "cron", cronExpr: "nope", lastRunAt: null }, at("2026-09-23T10:05:00"))).toBe(false);
  });
});
