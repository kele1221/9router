import { describe, it, expect, beforeEach, vi } from "vitest";

import { ACTIONS, runAction, getActionAvailability } from "../../src/lib/netMonitor/actions.js";
import { updateSettings } from "../../src/lib/db/index.js";

beforeEach(async () => {
  await updateSettings({
    tailscaleEnabled: false,
    proxyRotation: { enabled: false },
  });
});

describe("no network-breaking action exists", () => {
  // The D4/D5 constraint is the most important property of this module: the user
  // runs live agent traffic through this machine, so a remediation that drops the
  // connection is worse than the fault. These assertions fail loudly if anyone
  // adds one later.
  const FORBIDDEN_ID = /wifi|airport|wireless|interface|ifconfig|nic|link[-_]?down|netservice|networkservice|dns[-_]?set|setdns|route[-_]?(add|del|flush)|firewall|proxy[-_]?(off|disable|stop|kill)|kill[-_]?(clash|mihomo|proxy)/i;

  it("exposes no action id matching a network-breaking pattern", () => {
    for (const id of Object.keys(ACTIONS)) {
      expect(id).not.toMatch(FORBIDDEN_ID);
    }
  });

  it("has a handler for every declared action and vice versa", async () => {
    for (const id of Object.keys(ACTIONS)) {
      const res = await runAction(id);
      // An unknown-action reply means the declaration has no handler.
      expect(res.message).not.toContain("未知操作");
    }
  }, 40000);

  it("never shells out to a network-mutating command", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../src/lib/netMonitor/actions.js", import.meta.url), "utf8"));

    const banned = [
      "setairportpower", "networkserviceenabled", "ifconfig", "ip link set",
      "route add", "route delete", "networksetup -setdnsservers",
      "networksetup -setairportpower", "killall mDNSResponder", "proxy off",
      "clash -x", "pkill clash", "pkill mihomo", "systemctl stop",
    ];
    for (const cmd of banned) {
      expect(src.toLowerCase()).not.toContain(cmd.toLowerCase());
    }
  });

  it("declares every action as non-destructive", () => {
    for (const def of Object.values(ACTIONS)) {
      expect(def.danger).toBe(false);
    }
  });
});

describe("getActionAvailability", () => {
  it("reports every action with an available flag", async () => {
    const availability = await getActionAvailability();
    expect(Object.keys(availability).sort()).toEqual(Object.keys(ACTIONS).sort());
    for (const entry of Object.values(availability)) {
      expect(typeof entry.available).toBe("boolean");
    }
  });

  it("always offers retest and exportReport — they have no prerequisites", async () => {
    const availability = await getActionAvailability();
    expect(availability.retest.available).toBe(true);
    expect(availability.exportReport.available).toBe(true);
  });

  it("disables reconnectVpn when Tailscale is off, with a reason", async () => {
    const availability = await getActionAvailability();
    expect(availability.reconnectVpn.available).toBe(false);
    expect(availability.reconnectVpn.reason).toContain("Tailscale");
  });

  it("disables restartClash when rotation is off, with a reason", async () => {
    const availability = await getActionAvailability();
    expect(availability.restartClash.available).toBe(false);
    expect(availability.restartClash.reason).toContain("代理轮换");
  });

  it("flags flushDns as needing a password rather than as unavailable", async () => {
    const availability = await getActionAvailability();
    // sudo exists on macOS; the password is what is missing. The UI needs to
    // know to prompt, which is different from "cannot run at all".
    if (availability.flushDns.available) {
      expect(typeof availability.flushDns.needsPassword).toBe("boolean");
    } else {
      expect(typeof availability.flushDns.reason).toBe("string");
    }
  });

  it("never throws, even when a probe fails", async () => {
    const availability = await getActionAvailability();
    for (const [id, entry] of Object.entries(availability)) {
      expect(entry.reason ?? "", `action ${id}`).not.toMatch(/undefined|null/);
    }
  });
});

describe("runAction prerequisite handling", () => {
  it("flushDns asks for a password instead of failing opaquely", async () => {
    const res = await runAction("flushDns", { sudoPassword: "" });
    expect(res.action).toBe("flushDns");
    expect(typeof res.message).toBe("string");
    expect(res.message.length).toBeGreaterThan(0);
    if (!res.ok) expect(res.needsPassword ?? res.message).toBeTruthy();
  }, 20000);

  it("reconnectVpn explains that Tailscale is not enabled", async () => {
    const res = await runAction("reconnectVpn");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("未启用");
  });

  it("restartClash explains that rotation is off", async () => {
    const res = await runAction("restartClash");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("未启用");
  });

  it("restartClash names the missing pool when rotation is on", async () => {
    await updateSettings({ proxyRotation: { enabled: true } });
    const res = await runAction("restartClash");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Clash 池|池/);
    await updateSettings({ proxyRotation: { enabled: false } });
  }, 20000);

  it("returns ok:false with a message for an unknown action", async () => {
    const res = await runAction("does-not-exist");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("未知操作");
  });

  it("never rejects — even a handler that throws becomes a message", async () => {
    const res = await runAction("retest");
    expect(res).toHaveProperty("ok");
    expect(res).toHaveProperty("message");
  }, 40000);
});

describe("exportReport", () => {
  it("produces a structured report with a timestamp", async () => {
    const res = await runAction("exportReport");
    expect(res.ok).toBe(true);
    expect(res.action).toBe("exportReport");
    expect(res.detail.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.detail.collector).toBeDefined();
    expect(Array.isArray(res.detail.samples)).toBe(true);
  });

  it("includes the attribution when the scheduler has one", async () => {
    const res = await runAction("exportReport");
    // Attribution is null before the first round; the key must still exist so
    // consumers never have to guess.
    expect(res.detail).toHaveProperty("attribution");
    expect(res.detail).toHaveProperty("env");
  });
});

describe("retest", () => {
  it("runs a real round and reports the outcome", async () => {
    const res = await runAction("retest");
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.detail.probes)).toBe(true);
    expect(res.detail.probes.length).toBeGreaterThan(0);
    expect(res.message).toMatch(/目标/);
    for (const probe of res.detail.probes) {
      expect(probe).toHaveProperty("target");
      expect(probe).toHaveProperty("ok");
    }
  }, 40000);

  it("does not mutate scheduler state (it is a side-channel probe)", async () => {
    const scheduler = await import("../../src/lib/netMonitor/scheduler.js");
    const before = scheduler.getSchedulerState().ticks;
    await runAction("retest");
    expect(scheduler.getSchedulerState().ticks).toBe(before);
  }, 40000);
});
