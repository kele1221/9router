import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getSettings, updateSettings } from "../../src/lib/db/index.js";

// Scheduler is a module-level singleton guarded on global.__netMonitorScheduler,
// so each case resets it and drives tick() directly rather than waiting on timers.
async function loadScheduler() {
  vi.resetModules();
  return import("../../src/lib/netMonitor/scheduler.js");
}

// Poll until the predicate holds — a fixed sleep races the tick now that it also
// runs an env probe against the real host.
async function waitFor(predicate, { timeoutMs = 4000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// Scheduler tests exercise scheduling, not env probing — stubbing the env round
// keeps them fast and independent of the host's real network state.
function stubEnv(collector) {
  return vi.spyOn(collector, "collectEnvChange").mockResolvedValue({
    env: { vpn: { connected: false } },
    fingerprint: "stub",
    diff: null,
    sample: null,
  });
}

describe("netMonitor scheduler", () => {
  beforeEach(async () => {
    await updateSettings({ netMonitor: { enabled: false } });
    const mod = await loadScheduler();
    mod.resetSchedulerForTests();
  });

  afterEach(async () => {
    const mod = await loadScheduler();
    mod.stopNetMonitorScheduler();
    await updateSettings({ netMonitor: { enabled: false } });
    vi.restoreAllMocks();
  });

  it("starts no timer while disabled", async () => {
    const mod = await loadScheduler();
    await mod.startNetMonitorScheduler();
    expect(mod.getSchedulerState().running).toBe(false);
    mod.stopNetMonitorScheduler();
  });

  it("records a tick and collects once enabled", async () => {
    const settings = await getSettings();
    expect(settings.netMonitor?.enabled).toBe(false);

    const mod = await loadScheduler();
    const collector = await import("../../src/lib/netMonitor/collector.js");
    const spy = vi.spyOn(collector, "collectOnce").mockResolvedValue([
      { ts: new Date().toISOString(), target: "1.1.1.1", kind: "icmp", ok: true, rttAvgMs: 10, rttMinMs: 10, rttMaxMs: 10, jitterMs: 0, lossPct: 0, error: null },
    ]);
    stubEnv(collector);

    await updateSettings({ netMonitor: { enabled: true } });
    await mod.startNetMonitorScheduler();
    await waitFor(() => mod.getSchedulerState().ticks === 1);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(mod.getSchedulerState().ticks).toBe(1);
    expect(mod.getSchedulerState().lastError).toBeNull();
    mod.stopNetMonitorScheduler();
  });

  it("keeps the scheduler alive when a collection round throws", async () => {
    const mod = await loadScheduler();
    const collector = await import("../../src/lib/netMonitor/collector.js");
    vi.spyOn(collector, "collectOnce").mockRejectedValue(new Error("probe exploded"));
    stubEnv(collector);

    await updateSettings({ netMonitor: { enabled: true } });
    await mod.startNetMonitorScheduler();
    await waitFor(() => mod.getSchedulerState().lastError !== null);

    const state = mod.getSchedulerState();
    expect(state.lastError).toBe("probe exploded");
    expect(state.ticks).toBe(0);
    // Still armed for the retry — a failed round must not kill collection.
    expect(state.running).toBe(true);
    mod.stopNetMonitorScheduler();
  });

  // Regression: `running` used to be derived from the timer handle, which
  // tick() nulls while it works — so a UI polling mid-round saw "not running"
  // and flashed a stopped state, even though collection was healthy.
  it("reports running:true and collecting:true while a round is in flight", async () => {
    const mod = await loadScheduler();
    const collector = await import("../../src/lib/netMonitor/collector.js");
    let releaseRound;
    const gate = new Promise((resolve) => { releaseRound = resolve; });
    vi.spyOn(collector, "collectOnce").mockImplementation(async () => {
      await gate;
      return [];
    });
    stubEnv(collector);

    await updateSettings({ netMonitor: { enabled: true } });
    await mod.startNetMonitorScheduler();
    await waitFor(() => mod.getSchedulerState().collecting === true);

    const midRound = mod.getSchedulerState();
    expect(midRound.collecting).toBe(true);
    expect(midRound.running).toBe(true);

    releaseRound();
    await waitFor(() => mod.getSchedulerState().collecting === false);
    expect(mod.getSchedulerState().running).toBe(true);
    mod.stopNetMonitorScheduler();
  });

  it("reports running:false once stopped", async () => {
    const mod = await loadScheduler();
    const collector = await import("../../src/lib/netMonitor/collector.js");
    vi.spyOn(collector, "collectOnce").mockResolvedValue([]);
    stubEnv(collector);

    await updateSettings({ netMonitor: { enabled: true } });
    await mod.startNetMonitorScheduler();
    await waitFor(() => mod.getSchedulerState().ticks >= 1);
    expect(mod.getSchedulerState().running).toBe(true);

    mod.stopNetMonitorScheduler();
    expect(mod.getSchedulerState().running).toBe(false);
  });

  it("stops re-arming once disabled and stopped, as the settings route does", async () => {
    const mod = await loadScheduler();
    const collector = await import("../../src/lib/netMonitor/collector.js");
    const spy = vi.spyOn(collector, "collectOnce").mockResolvedValue([]);
    stubEnv(collector);

    await updateSettings({ netMonitor: { enabled: true } });
    await mod.startNetMonitorScheduler();
    await waitFor(() => spy.mock.calls.length > 0);

    // The settings route calls stop() whenever the netMonitor key changes; a
    // tick that finds enabled:false would otherwise re-arm 60s later.
    await updateSettings({ netMonitor: { enabled: false } });
    mod.stopNetMonitorScheduler();
    const calls = spy.mock.calls.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(spy.mock.calls.length).toBe(calls);
    expect(mod.getSchedulerState().running).toBe(false);
  });
});
