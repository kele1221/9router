import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "http";
import { ClashController, clashRotate, resetClashControllersForTests } from "@/lib/network/clashController";

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(),
}));

// ── Fake Mihomo controller ──────────────────────────────────────────
function makeFakeController({ delays = {} } = {}) {
  const calls = { delays: [], switches: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, data) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(data === undefined ? "" : JSON.stringify(data));
    };

    if (req.method === "GET" && url.pathname === "/configs") {
      return send(200, { mode: "rule" });
    }
    if (req.method === "GET" && url.pathname === "/proxies") {
      const proxies = {
        "节点选择": {
          type: "Selector",
          now: "🇯🇵 JP1",
          all: ["🇯🇵 JP1", "🇸🇬 SG1", "🇭🇰 HK1", "DIRECT"],
        },
        "AI-Provider": {
          type: "Selector",
          now: "AI1",
          all: ["AI1", "AI2", "AI3", "节点选择"],
        },
        AI1: { type: "Shadowsocks" },
        AI2: { type: "Shadowsocks" },
        AI3: { type: "Shadowsocks" },
      };
      return send(200, { proxies });
    }
    const delayMatch = url.pathname.match(/^\/proxies\/([^/]+)\/delay$/);
    if (req.method === "GET" && delayMatch) {
      const node = decodeURIComponent(delayMatch[1]);
      calls.delays.push(node);
      const delay = delays[node] ?? 100;
      if (delay === null) return send(500, {});
      return send(200, { delay });
    }
    const switchMatch = url.pathname.match(/^\/proxies\/([^/]+)$/);
    if (req.method === "PUT" && switchMatch) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { name } = JSON.parse(body);
        calls.switches.push({ group: decodeURIComponent(switchMatch[1]), name });
        send(204);
      });
      return;
    }
    return send(404, {});
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port,
        url: `http://127.0.0.1:${server.address().port}`,
        calls,
      });
    });
  });
}

function makeController(url, extra = {}) {
  return new ClashController({
    controllerUrl: url,
    controllerUnixSocket: "/nonexistent-9router-test.sock",
    selectorGroup: "节点选择",
    aiSelectorGroup: "AI-Provider",
    cooldownMs: 3000,
    ...extra,
  });
}

let fake;
beforeEach(async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  fake = await makeFakeController();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetClashControllersForTests();
  fake?.server?.close();
});

describe("ClashController", () => {
  it("init connects and reads current selector + AI node", async () => {
    const c = makeController(fake.url);
    await c.init();
    expect(c.ready).toBe(true);
    expect(c.currentNode).toBe("🇯🇵 JP1");
    expect(c.currentAiNode).toBe("AI1");
    c.stop();
  });

  it("autoSwitchForAi respects cooldown", async () => {
    const c = makeController(fake.url);
    await c.init();
    c.lastAiSwitch = Date.now();
    const res = await c.autoSwitchForAi(c.currentAiNode);
    expect(res).toEqual({ switched: false, reason: "cooldown" });
    c.stop();
  });

  it("findAiCandidate weights low latency higher", async () => {
    fake.server.close();
    fake = await makeFakeController({ delays: { AI2: 100, AI3: 2990 } });
    const c = makeController(fake.url);
    await c.init();
    const pick = await c.findAiCandidate("AI1");
    expect(pick.node).toBe("AI2");
    c.stop();
  });

  it("findAiCandidate excludes current node and rate-limited nodes", async () => {
    const c = makeController(fake.url);
    await c.init();
    c.markNodeRateLimited("AI2");
    const pick = await c.findAiCandidate("AI1");
    expect(pick.node).toBe("AI3");
    expect(c.getRateLimitedNodes()).toContain("AI2");
    c.stop();
  });

  it("only nodes below delay threshold qualify; too-slow excluded", async () => {
    fake.server.close();
    fake = await makeFakeController({ delays: { AI2: 100, AI3: 5000 } });
    const c = makeController(fake.url);
    await c.init();
    const pick = await c.findAiCandidate("AI1");
    expect(pick.node).toBe("AI2");
    expect(fake.calls.delays).toContain("AI3"); // tested but rejected by threshold
    c.stop();
  });

  it("no candidate degrades to system selector", async () => {
    const c = makeController(fake.url);
    await c.init();
    // Mark every AI candidate cooling so findAiCandidate returns null.
    c.aiFailedUntil.set("AI2", Date.now() + 600000);
    c.aiFailedUntil.set("AI3", Date.now() + 600000);
    const res = await c.autoSwitchForAi("AI1");
    expect(res.switched).toBe(true);
    expect(res.reason).toBe("ai failover to system selector");
    expect(c.proxyMode).toBe("system");
    c.stop();
  });

  it("unreachable controller fails open (no throw)", async () => {
    const c = makeController("http://127.0.0.1:1");
    await c.init(); // must not throw
    expect(c.ready).toBe(false);
    expect(await c.getProxies()).toBeNull();
    const sw = await c.autoSwitchForAi("AI1");
    expect(sw.switched).toBe(false);
    const node = await c.switchNode("x");
    expect(node.success).toBe(false);
    c.stop();
  });
});

describe("clashRotate hook", () => {
  it("rate_limit freezes current AI node and auto-switches", async () => {
    const { getProxyPoolById } = await import("@/models");
    getProxyPoolById.mockResolvedValue({
      id: "clash-pool",
      type: "clash",
      clash: { controllerUrl: fake.url, controllerUnixSocket: "/nonexistent-9router-test.sock" },
    });
    const c = makeController(fake.url);
    // Prime the singleton with our controller (same endpoint key as clashRotate).
    const controller = (await import("@/lib/network/clashController")).getClashController({
      clash: { controllerUrl: fake.url, controllerUnixSocket: "/nonexistent-9router-test.sock" },
    });
    await controller.init();
    const res = await clashRotate({
      credentials: {
        providerSpecificData: { connectionProxyPoolId: "clash-pool", connectionProxyUrl: `socks5://127.0.0.1:7890` },
      },
      status: 429,
      kind: "rate_limit",
    });
    expect(res.success).toBe(true);
    expect(controller.getRateLimitedNodes()).toContain("AI1");
    expect(fake.calls.switches.length).toBeGreaterThan(0);
  });
});
