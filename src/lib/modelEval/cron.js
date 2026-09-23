// Minimal 5-field cron matcher (minute hour day-of-month month day-of-week).
// Supports `*`, `?`, `*/n`, `a-b`, `a-b/n`, comma lists and plain numbers.
// No dependency: node-cron would be a library for ~50 lines of arithmetic.

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dayOfMonth", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "dayOfWeek", min: 0, max: 6 },
];

function parseField(spec, field) {
  const raw = String(spec).trim();
  if (raw === "" ) throw new Error(`Empty ${field.name} field`);
  if (raw === "*" || raw === "?") return { values: null, wildcard: true };
  const values = new Set();
  for (const part of raw.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step in ${field.name}: ${part}`);
    let start;
    let end;
    if (rangePart === "*" || rangePart === "?") {
      start = field.min;
      end = field.max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map((v) => Number(v));
      start = a;
      end = b;
    } else {
      start = Number(rangePart);
      end = stepPart === undefined ? start : field.max;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < field.min || end > field.max || start > end) {
      throw new Error(`Invalid ${field.name} value: ${part}`);
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  if (values.size === 0) throw new Error(`Empty ${field.name} field`);
  return { values, wildcard: false };
}

export function parseCron(expr) {
  const parts = String(expr ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) throw new Error("Cron expression must have exactly 5 fields");
  const parsed = FIELDS.map((field, i) => ({ ...field, ...parseField(parts[i], field) }));
  return {
    minute: parsed[0],
    hour: parsed[1],
    dayOfMonth: parsed[2],
    month: parsed[3],
    dayOfWeek: parsed[4],
  };
}

function fieldMatches(field, value) {
  return field.wildcard || field.values.has(value);
}

export function cronMatches(cron, date = new Date()) {
  const parsed = typeof cron === "string" ? parseCron(cron) : cron;
  if (!fieldMatches(parsed.minute, date.getMinutes())) return false;
  if (!fieldMatches(parsed.hour, date.getHours())) return false;
  if (!fieldMatches(parsed.month, date.getMonth() + 1)) return false;
  const domOk = fieldMatches(parsed.dayOfMonth, date.getDate());
  const dowOk = fieldMatches(parsed.dayOfWeek, date.getDay());
  // Standard cron: when both day fields are restricted, either may match.
  if (!parsed.dayOfMonth.wildcard && !parsed.dayOfWeek.wildcard) return domOk || dowOk;
  return domOk && dowOk;
}
