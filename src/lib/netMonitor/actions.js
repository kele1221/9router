// Remediation actions offered by the network monitor.
//
// Hard constraint (task D4/D5): NOTHING here may interrupt the network. No
// closing Wi-Fi, no taking an interface down, no disabling the user's proxy, no
// rewriting system DNS. The user runs live agent traffic through this machine,
// so a "fix" that drops the connection costs more than the fault it repairs.
// Every action below is either read-only or self-contained to 9Router's own
// subsystem. Adding a network-breaking action here is out of scope by design.

export const ACTIONS = {
  retest: { label: "重测链路", danger: false, description: "立即执行一轮探测，不等待下一个采集周期" },
  flushDns: { label: "清 DNS 缓存", danger: false, description: "清除系统 DNS 缓存（需要 sudo 权限，会提示）" },
  reconnectVpn: { label: "重连 Tailscale", danger: false, description: "重启 9Router 管理的 Tailscale 连接" },
  restartClash: { label: "重启代理控制器", danger: false, description: "重启 9Router 管理的 Clash/mihomo 控制器" },
  exportReport: { label: "导出诊断报告", danger: false, description: "汇总当前探测、环境与归因结果为 JSON" },
};

export async function runAction(action, { sudoPassword } = {}) {
  const handler = HANDLERS[action];
  if (!handler) return { ok: false, action, message: `未知操作：${action}` };
  try {
    return await handler({ sudoPassword });
  } catch (err) {
    return { ok: false, action, message: err?.message || "操作执行失败" };
  }
}

// Read-only availability probe so the UI can disable what cannot work instead
// of offering a button that fails. Cheap enough to call on page load.
export async function getActionAvailability() {
  const out = {};
  for (const id of Object.keys(ACTIONS)) {
    try {
      out[id] = await AVAILABILITY[id]?.() ?? { available: true };
    } catch (err) {
      out[id] = { available: false, reason: err?.message || "无法判断可用性" };
    }
  }
  return out;
}

const AVAILABILITY = {
  retest: async () => ({ available: true }),
  exportReport: async () => ({ available: true }),

  flushDns: async () => {
    const dnsConfig = await import("@/mitm/dns/dnsConfig.js");
    if (!dnsConfig.isSudoAvailable?.()) {
      return { available: false, reason: "系统未提供 sudo" };
    }
    if (dnsConfig.isSudoPasswordRequired?.()) {
      return { available: true, needsPassword: true };
    }
    return { available: true, needsPassword: false };
  },

  reconnectVpn: async () => {
    const { getSettings } = await import("@/lib/db/index.js");
    const settings = await getSettings();
    if (!settings.tailscaleEnabled) {
      return { available: false, reason: "9Router 未启用 Tailscale" };
    }
    const { getTailscaleBin } = await import("@/lib/tunnel/tailscale/tailscale.js");
    if (!getTailscaleBin?.()) {
      return { available: false, reason: "未检测到 tailscale 可执行文件" };
    }
    return { available: true };
  },

  restartClash: async () => {
    const { getSettings, getProxyPools } = await import("@/lib/localDb");
    const settings = await getSettings();
    if (!settings?.proxyRotation?.enabled) {
      return { available: false, reason: "代理轮换未启用" };
    }
    const pools = (await getProxyPools({ isActive: true })).filter((p) => p.type === "clash");
    if (!pools.length) {
      return { available: false, reason: "没有启用的 Clash 池" };
    }
    return { available: true };
  },
};

const HANDLERS = {
  retest: async () => {
    const { collectOnce, collectEnvChange } = await import("./collector.js");
    const { getSettings } = await import("@/lib/db/index.js");
    const { resolveNetMonitorConfig } = await import("./config.js");

    const config = resolveNetMonitorConfig(await getSettings());
    const probes = await collectOnce({ targets: config.targets });
    const env = await collectEnvChange({}).catch(() => null);

    const failed = probes.filter((p) => !p.ok);
    return {
      ok: true,
      action: "retest",
      message: failed.length
        ? `${probes.length} 个目标中 ${failed.length} 个失败`
        : `${probes.length} 个目标全部正常`,
      detail: { probes, env: env?.env ?? null },
    };
  },

  flushDns: async ({ sudoPassword }) => {
    const dnsConfig = await import("@/mitm/dns/dnsConfig.js");
    if (!dnsConfig.isSudoAvailable?.()) {
      return { ok: false, action: "flushDns", message: "系统未提供 sudo，无法清理 DNS 缓存" };
    }
    if (dnsConfig.isSudoPasswordRequired?.() && !sudoPassword) {
      return { ok: false, action: "flushDns", message: "需要 sudo 密码才能清理 DNS 缓存", needsPassword: true };
    }
    await dnsConfig.flushDNS(sudoPassword);
    return { ok: true, action: "flushDns", message: "DNS 缓存已清理" };
  },

  reconnectVpn: async () => {
    const { getSettings } = await import("@/lib/db/index.js");
    const settings = await getSettings();
    if (!settings.tailscaleEnabled) {
      return { ok: false, action: "reconnectVpn", message: "9Router 未启用 Tailscale，无需重连" };
    }
    const { disableTailscale, enableTailscale } = await import("@/lib/tunnel");
    await disableTailscale();
    await enableTailscale();
    return { ok: true, action: "reconnectVpn", message: "Tailscale 已重连" };
  },

  restartClash: async () => {
    const { getSettings, getProxyPools } = await import("@/lib/localDb");
    const settings = await getSettings();
    if (!settings?.proxyRotation?.enabled) {
      return { ok: false, action: "restartClash", message: "代理轮换未启用，没有可重启的控制器" };
    }
    const pools = (await getProxyPools({ isActive: true })).filter((p) => p.type === "clash");
    if (!pools.length) {
      return { ok: false, action: "restartClash", message: "没有启用的 Clash 池" };
    }

    // No public restart exists on the controller; init() is the re-connect path
    // (it re-reads /configs and re-applies the proxy mode). It only touches
    // 9Router's own controller connection — mihomo itself keeps running, so the
    // user's traffic is not interrupted.
    const { getClashController } = await import("@/lib/network/clashController.js");
    const controller = getClashController(pools[0]);
    controller.ready = false;
    await controller.init();

    return controller.ready
      ? { ok: true, action: "restartClash", message: `控制器已重连（${pools[0].name || pools[0].id}）` }
      : { ok: false, action: "restartClash", message: "控制器重连失败，请检查 Clash/mihomo 是否在运行" };
  },

  exportReport: async () => {
    const { getSchedulerState } = await import("./scheduler.js");
    const { getLatestSamples } = await import("@/lib/db/index.js");
    const { summarize } = await import("./attribution.js");

    const state = getSchedulerState();
    const samples = await getLatestSamples(200);
    const report = {
      generatedAt: new Date().toISOString(),
      collector: {
        running: state.running,
        ticks: state.ticks,
        lastTickAt: state.lastTickAt,
        lastError: state.lastError,
      },
      attribution: state.verdict ? { ...state.verdict, summary: summarize(state.verdict) } : null,
      env: state.env ?? null,
      samples,
    };
    return { ok: true, action: "exportReport", message: `已生成报告（${samples.length} 条样本）`, detail: report };
  },
};
