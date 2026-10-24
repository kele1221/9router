import { pruneRaw, pruneHourly, pruneEnv } from "@/lib/db/index.js";

const DAY_MS = 86400000;

export function rawCutoff(now, rawRetentionDays) {
  return new Date(now.getTime() - rawRetentionDays * DAY_MS).toISOString();
}

// Hour buckets are the ISO hour prefix, matching the `bucket` column format.
export function hourBucket(date) {
  return date.toISOString().slice(0, 13);
}

export function hourlyCutoffBucket(now, hourlyRetentionDays) {
  return hourBucket(new Date(now.getTime() - hourlyRetentionDays * DAY_MS));
}

export function envCutoff(now, envRetentionDays) {
  return new Date(now.getTime() - envRetentionDays * DAY_MS).toISOString();
}

export async function runRetention(now, { rawRetentionDays, hourlyRetentionDays, envRetentionDays = 180 }) {
  await pruneRaw(rawCutoff(now, rawRetentionDays));
  await pruneHourly(hourlyCutoffBucket(now, hourlyRetentionDays));
  await pruneEnv(envCutoff(now, envRetentionDays));
}
