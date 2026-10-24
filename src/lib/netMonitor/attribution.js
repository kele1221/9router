// Attribution: turns one round of probe + environment results into a single
// "which layer is broken" verdict.
//
// Pure by design — no IO, no clock, no module state. `prev` is injected by the
// caller (the collector keeps it across ticks), which is what makes the
// "two consecutive rounds" rule testable without timers.

export const LAYERS = {
  LOCAL: "local",
  DNS: "dns",
  VPN: "vpn",
  PROXY: "proxy",
  UPSTREAM: "upstream",
  UNKNOWN: "unknown",
};

// A single failed round never flips the verdict: transient loss is normal on
// Wi-Fi and would make the panel cry wolf. Two rounds in the same direction is
// ~2 minutes at the default 60s interval.
export const CONFIRMATION_ROUNDS = 2;

/**
 * @param {object} input
 * @param {Array}  input.probes   probe samples for this round ({target, kind, ok, ...})
 * @param {object} input.env      collectLocalEnv() result
 * @param {object} [input.envDiff] diffEnv() result from this round, if the env changed
 * @param {object} [input.prev]   previous verdict ({ layer, streak, candidate })
 * @returns {{layer: string, confidence: "high"|"medium"|"low", reasons: string[], pending: boolean, streak: number, candidate: string}}
 */
export function attribute({ probes = [], env = null, envDiff = null, prev = null } = {}) {
  const verdict = evaluate({ probes, env, envDiff });

  const streak = prev && prev.candidate === verdict.layer && verdict.layer !== LAYERS.UNKNOWN
    ? (prev.streak || 1) + 1
    : 1;

  // Unknown never gets promoted by streak — it means "not enough evidence", not
  // "confirmed nothing is wrong".
  const confirmed = verdict.layer === LAYERS.UNKNOWN
    ? true
    : streak >= CONFIRMATION_ROUNDS;

  return {
    layer: verdict.layer,
    confidence: confirmed ? verdict.confidence : "low",
    reasons: confirmed
      ? verdict.reasons
      : [pendingNote(verdict.layer, streak), ...verdict.reasons],
    pending: !confirmed,
    streak,
    candidate: verdict.layer,
  };
}

function pendingNote(layer, streak) {
  return `检测到疑似${LAYER_LABELS[layer] || layer}异常（第 ${streak}/${CONFIRMATION_ROUNDS} 轮），需再确认一轮才告警`;
}

const LAYER_LABELS = {
  [LAYERS.LOCAL]: "本机网络",
  [LAYERS.DNS]: "DNS",
  [LAYERS.VPN]: "VPN",
  [LAYERS.PROXY]: "代理",
  [LAYERS.UPSTREAM]: "上游服务",
  [LAYERS.UNKNOWN]: "未知层",
};

// Short-circuit order, from most certain to most speculative.
function evaluate({ probes, env, envDiff }) {
  const icmp = probes.filter((p) => p.kind === "icmp");
  const tcp = probes.filter((p) => p.kind === "tcp");
  const dns = probes.filter((p) => p.kind === "dns");
  const upstream = probes.filter((p) => p.kind === "upstream");

  const icmpOk = icmp.some((p) => p.ok);
  const icmpTotal = icmp.length;
  const tcpOk = tcp.some((p) => p.ok);
  const dnsOk = dns.some((p) => p.ok);
  const upstreamOk = upstream.some((p) => p.ok);
  const upstreamTotal = upstream.length;

  // 1. An observed VPN drop is the most specific cause, so it outranks the
  //    catch-all "everything failed" rule: when the tunnel dies, every probe
  //    fails identically, and blaming the local link would send you looking at
  //    the wrong thing. Only an observed transition counts — never inference
  //    from interface presence.
  const vpnDropped = envDiffHas(envDiff, "vpnConnected", true, false);
  if (vpnDropped && !(icmpOk && dnsOk)) {
    return {
      layer: LAYERS.VPN,
      confidence: "medium",
      reasons: [
        "VPN 状态由已连接变为未连接",
        `ICMP ${icmpOk ? "部分可达" : "不可达"}，DNS ${dnsOk ? "正常" : "失败"}`,
        `出口 IP ${env?.egress?.ip ?? "未知"}`,
      ],
    };
  }

  // 2. Nothing reaches anything and no VPN transition explains it.
  if (icmpTotal && !icmpOk && !tcpOk && !upstreamOk) {
    const localDown = isLocalLinkDown(env);
    return {
      layer: LAYERS.LOCAL,
      confidence: localDown ? "high" : "medium",
      reasons: [
        `ICMP ${icmpTotal} 个目标全部失败`,
        tcp.length ? `TCP ${tcp.length} 个目标全部失败` : "无 TCP 目标",
        localDown
          ? `默认路由缺失（网关 ${env?.route?.gateway ?? "未知"}，接口 ${env?.route?.interface ?? "未知"}）`
          : `默认路由仍在（网关 ${env?.route?.gateway ?? "未知"}）`,
      ],
    };
  }

  // 3. Packets flow but names do not resolve.
  if (!dnsOk && dns.length && (icmpOk || tcpOk || upstreamOk)) {
    return {
      layer: LAYERS.DNS,
      confidence: "high",
      reasons: [
        `ICMP ${icmpOk ? "可达" : "不可达"}，TCP ${tcpOk ? "可达" : "不可达"}`,
        `DNS 解析 ${dns.length} 个域名全部失败`,
        ...(env?.dnsServers?.length ? [`当前系统 DNS：${env.dnsServers.join(", ")}`] : []),
      ],
    };
  }

  // 4. Proxied path fails while direct path works.
  const proxyDown = env?.clash?.present && !env.clash.selected;
  if (proxyDown && icmpOk) {
    return {
      layer: LAYERS.PROXY,
      confidence: "medium",
      reasons: [
        "代理控制器在线，但没有选中的节点",
        `ICMP 直连正常（${icmp.filter((p) => p.ok).length}/${icmpTotal}）`,
      ],
    };
  }

  // 5. Everything local is fine, but a provider is unreachable.
  if (upstreamTotal && !upstreamOk && (icmpOk || tcpOk)) {
    const failed = upstream.map((p) => p.target).join(", ");
    return {
      layer: LAYERS.UPSTREAM,
      confidence: "high",
      reasons: [
        `本机到公网正常（ICMP ${icmpOk ? "通" : "不通"}）`,
        `上游 ${upstreamTotal} 个目标全部失败：${failed}`,
      ],
    };
  }

  // 6. Not enough evidence. Say so instead of guessing.
  return {
    layer: LAYERS.UNKNOWN,
    confidence: "low",
    reasons: [
      icmpTotal ? `ICMP ${icmp.filter((p) => p.ok).length}/${icmpTotal} 正常` : "无 ICMP 结果",
      dns.length ? `DNS ${dns.filter((p) => p.ok).length}/${dns.length} 正常` : "无 DNS 结果",
      upstreamTotal ? `上游 ${upstream.filter((p) => p.ok).length}/${upstreamTotal} 正常` : "无上游结果",
      icmpOnlyFailure(icmp, tcp, dns, upstream)
        ? "ICMP 全部失败但 TCP/DNS 正常，判断为 ICMP 被限速或过滤，非网络故障"
        : "当前证据不足以定位到具体层级",
    ],
  };
}

// Many networks deprioritise or drop ICMP while serving TCP fine. A high ICMP
// loss rate there looks alarming to a naive reading but is not a fault, so it
// must not surface as one — it would make the monitor cry wolf on a healthy
// connection. Partial loss counts too: 66% ICMP loss with TCP at 1ms is
// filtering, not degradation.
function icmpOnlyFailure(icmp, tcp, dns, upstream) {
  if (!icmp.length) return false;
  const transport = [...tcp, ...dns, ...upstream];
  if (!transport.length || !transport.every((p) => p.ok)) return false;

  // Every ICMP target failed outright, or the loss rate is high enough that the
  // transport layer would have to be affected too if it were real congestion.
  const allFailed = icmp.every((p) => !p.ok);
  const heavyLoss = icmp.some((p) => (p.lossPct ?? 0) >= ICMP_LOSS_SUSPECT_PCT);
  return allFailed || heavyLoss;
}

// ICMP loss at or above this, with a perfectly healthy transport layer, is
// treated as policy rather than congestion.
const ICMP_LOSS_SUSPECT_PCT = 30;

function isLocalLinkDown(env) {
  if (!env?.route) return false;
  return !env.route.gateway && !env.route.interface;
}

// True when the env diff reports `field` moving from `from` to `to`. Keeps the
// VPN rule honest: only an observed transition counts, never an assumption.
function envDiffHas(envDiff, field, from, to) {
  if (!envDiff?.fields) return false;
  return envDiff.fields.some((f) => f.field === field && f.from === from && f.to === to);
}

export function summarize(verdict) {
  if (!verdict) return "";
  const label = LAYER_LABELS[verdict.layer] || verdict.layer;
  return verdict.pending ? `${label}（待确认）` : label;
}
