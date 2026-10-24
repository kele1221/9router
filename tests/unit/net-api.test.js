import { describe, it, expect, beforeEach, vi } from "vitest";

import { insertSamples } from "../../src/lib/db/index.js";
import { getAdapter } from "../../src/lib/db/driver.js";
import { ACTIONS, runAction } from "../../src/lib/netMonitor/actions.js";
import { GET as getHistory } from "../../src/app/api/net-monitor/history/route.js";
import { GET as getAttribution } from "../../src/app/api/net-monitor/attribution/route.js";
import { POST as postActions, GET as getActions } from "../../src/app/api/net-monitor/actions/route.js";
import { resetSchedulerForTests } from "../../src/lib/netMonitor/scheduler.js";

const sample = (over = {}) => ({
  ts: new Date().toISOString(),
  target: "1.1.1.1",
  kind: "icmp",
  ok: true,
  rttAvgMs: 40,
  rttMinMs: 39,
  rttMaxMs: 41,
  jitterMs: 1,
  lossPct: 0,
  error: null,
  ...over,
});

beforeEach(async () => {
  const db = await getAdapter();
  db.run(`DELETE FROM netMonitorSamples`);
  db.run(`DELETE FROM netMonitorHourly`);
  resetSchedulerForTests();
});

const req = (url, init) => new Request(url, init);

describe("GET /api/net-monitor/history", () => {
  it("defaults to 24h and reads the raw table", async () => {
    await insertSamples([sample()]);
    const res = await getHistory(req("http://localhost/api/net-monitor/history"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.period).toBe("24h");
    expect(body.source).toBe("raw");
    expect(body.points).toHaveLength(1);
  });

  it("reads the hourly table for 90d", async () => {
    const res = await getHistory(req("http://localhost/api/net-monitor/history?period=90d"));
    const body = await res.json();
    expect(body.source).toBe("hourly");
  });

  it("rejects an unknown period with 400", async () => {
    const res = await getHistory(req("http://localhost/api/net-monitor/history?period=banana"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid period");
  });

  it("scopes to a single target", async () => {
    await insertSamples([sample({ target: "1.1.1.1" }), sample({ target: "8.8.8.8" })]);
    const res = await getHistory(req("http://localhost/api/net-monitor/history?period=24h&target=8.8.8.8"));
    const body = await res.json();
    expect(body.points).toHaveLength(1);
    expect(body.points[0].target).toBe("8.8.8.8");
  });
});

describe("GET /api/net-monitor/attribution", () => {
  it("reports ready:false before the first round", async () => {
    const res = await getAttribution();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ready).toBe(false);
    expect(body.reasons).toEqual([]);
  });

  it("reports the verdict the scheduler holds once it has one", async () => {
    const { attribute } = await import("../../src/lib/netMonitor/attribution.js");
    const scheduler = await import("../../src/lib/netMonitor/scheduler.js");
    const verdict = attribute({ probes: [sample({ ok: false })], env: { route: { gateway: null, interface: null } } });

    // Drive the real path: one mocked collection round through the scheduler.
    const collector = await import("../../src/lib/netMonitor/collector.js");
    vi.spyOn(collector, "collectOnce").mockResolvedValue([sample({ ok: false })]);
    vi.spyOn(collector, "collectEnvChange").mockResolvedValue({ env: { route: null, vpn: null }, fingerprint: "x", diff: null, sample: null });
    const { updateSettings } = await import("../../src/lib/db/index.js");
    await updateSettings({ netMonitor: { enabled: true } });
    await scheduler.startNetMonitorScheduler();
    await waitFor(() => scheduler.getSchedulerState().verdict !== null);

    const res = await getAttribution();
    const body = await res.json();
    expect(body.ready).toBe(true);
    expect(typeof body.layer).toBe("string");
    expect(body.reasons.length).toBeGreaterThan(0);
    expect(body.summary).toBeTruthy();
    scheduler.stopNetMonitorScheduler();
    expect(verdict.layer).toBe("local");
  });
});

async function waitFor(predicate, { timeoutMs = 4000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

describe("POST /api/net-monitor/actions", () => {
  // isLocalRequest() trusts x-9r-real-ip only when custom-server.js's per-process
  // secret comes with it. Tests must act like that stamp, not like a bare client.
  const TOKEN = "test-peer-token";
  const localReq = (body, { trusted = true } = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (trusted) {
      headers["x-9r-peer-token"] = TOKEN;
      headers["x-9r-real-ip"] = "127.0.0.1";
    }
    return req("http://localhost/api/net-monitor/actions", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  };

  beforeEach(() => {
    process.env.NINEROUTER_PEER_TOKEN = TOKEN;
  });

  it("rejects a non-local caller with 403", async () => {
    const res = await postActions(localReq({ action: "retest" }, { trusted: false }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Local only");
  });

  it("rejects a caller claiming loopback without the peer token", async () => {
    const res = await postActions(req("http://localhost/api/net-monitor/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-9r-real-ip": "127.0.0.1" },
      body: JSON.stringify({ action: "retest" }),
    }));
    expect(res.status).toBe(403);
  });

  it("rejects a missing action with 400", async () => {
    const res = await postActions(localReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing action");
  });

  it("rejects an unknown action with 400 and lists the valid ones", async () => {
    const res = await postActions(localReq({ action: "rm-rf" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("flushDns");
  });

  it("lists the available actions via GET", async () => {
    const res = await getActions();
    const body = await res.json();
    const ids = body.actions.map((a) => a.id).sort();
    expect(ids).toEqual(["exportReport", "flushDns", "reconnectVpn", "restartClash", "retest"]);
  });

  it("marks every action as non-destructive", () => {
    for (const def of Object.values(ACTIONS)) {
      expect(def.danger).toBe(false);
    }
  });

  it("exposes no action that could cut the network", () => {
    // Guards the D4/D5 constraint at the API surface, not just by convention.
    const forbidden = /wifi|airport|interface|ifconfig|link|dns.*set|networkservice|route.*add|proxy.*(off|disable)/i;
    for (const id of Object.keys(ACTIONS)) {
      expect(id).not.toMatch(forbidden);
    }
  });
});

describe("runAction", () => {
  it("retest returns real probe results", async () => {
    const res = await runAction("retest");
    expect(res.ok).toBe(true);
    expect(res.action).toBe("retest");
    expect(Array.isArray(res.detail.probes)).toBe(true);
    expect(res.message).toMatch(/目标/);
  }, 30000);

  it("flushDns reports a readable reason when it cannot proceed", async () => {
    const res = await runAction("flushDns", { sudoPassword: "" });
    expect(res.action).toBe("flushDns");
    // Either it flushed, or it explains what is missing — never a bare throw.
    expect(typeof res.message).toBe("string");
    expect(res.message.length).toBeGreaterThan(0);
  });

  it("reconnectVpn says why when Tailscale is not enabled in 9Router", async () => {
    const { updateSettings } = await import("../../src/lib/db/index.js");
    await updateSettings({ tailscaleEnabled: false });
    const res = await runAction("reconnectVpn");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("未启用");
  });

  it("restartClash says why when rotation is off", async () => {
    const res = await runAction("restartClash");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("未启用");
  });

  it("exportReport bundles collector state, attribution and samples", async () => {
    await insertSamples([sample()]);
    const res = await runAction("exportReport");
    expect(res.ok).toBe(true);
    expect(res.detail.generatedAt).toBeTruthy();
    expect(res.detail.collector).toBeDefined();
    expect(Array.isArray(res.detail.samples)).toBe(true);
    expect(res.detail.samples.length).toBe(1);
  });

  it("returns ok:false with a message for an unknown action", async () => {
    const res = await runAction("nope");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("未知操作");
  });
});
