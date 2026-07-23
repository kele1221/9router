import { RATE_LIMIT_ERROR_MARKER } from "open-sse/config/errorConfig.js";

function normalizeUrl(value) {
  const raw = String(value || "").replace(/\/+$/, "");
  try {
    const url = new URL(raw);
    const hostname = ["127.0.0.1", "[::1]"].includes(url.hostname) ? "localhost" : url.hostname;
    const port = url.port ? `:${url.port}` : "";
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${hostname}${port}${pathname}${url.search}`;
  } catch {
    return raw;
  }
}

function joinUrl(baseUrl, suffix) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const pathSuffix = String(suffix || "").replace(/^\/+/, "");
  if (!base) return null;
  return pathSuffix ? `${base}/${pathSuffix}` : base;
}

function publicProviderNode(node) {
  if (!node) return null;
  return {
    id: node.id,
    name: node.name || null,
    baseUrl: node.baseUrl || null,
  };
}
export function buildRoutingGovernanceStatus({
  config,
  providerNodes = [],
  runtimeState = {},
  now = () => new Date(),
}) {
  const providerHop = config.chain.hops.find((hop) => hop.kind === "provider");
  const proxyHop = config.chain.hops.find((hop) => hop.kind === "proxy");
  const routerHop = config.chain.hops.find((hop) => hop.kind === "router");
  const runtimeVerification = config.runtimeVerification;
  const actualNode = providerNodes.find((node) => node.id === providerHop?.providerNodeId) || null;
  const publicNode = publicProviderNode(actualNode);
  const responseRule = config.responseRules.find((rule) => (
    rule.when?.status === 400
    && rule.when?.errorCodeOrType === RATE_LIMIT_ERROR_MARKER
    && rule.then?.effectiveStatus === 429
    && rule.then?.preserveBody === true
  ));
  const expectedClientBaseUrl = runtimeVerification
    ? joinUrl(proxyHop?.url, runtimeVerification.modelSwitchPathPrefix)
    : null;
  const expectedRouterBaseUrl = runtimeVerification
    ? joinUrl(routerHop?.url, runtimeVerification.routerApiPrefix)
    : null;
  const actualClientBaseUrl = runtimeState.client?.baseUrl || null;
  const actualModelSwitchBaseUrl = runtimeState.modelSwitch?.currentProvider?.baseUrl || null;

  const checks = [
    {
      id: "provider-node-exists",
      label: "供应商节点存在",
      status: actualNode ? "pass" : "fail",
      detail: actualNode ? providerHop.providerNodeId : `未找到 ${providerHop?.providerNodeId || "provider node"}`,
    },
    {
      id: "provider-base-url",
      label: "供应商 Base URL 与文档一致",
      status: actualNode && normalizeUrl(actualNode.baseUrl) === normalizeUrl(providerHop?.baseUrl) ? "pass" : "fail",
      detail: publicNode?.baseUrl || "无运行配置",
    },
    {
      id: "response-normalization",
      label: "400 rate_limit_exceeded → 429",
      status: responseRule ? "pass" : "fail",
      detail: responseRule ? "响应体保持不变，并在模型锁定前归一化" : "规则缺失或不完整",
    },
    {
      id: "claude-cn-model-switch-route",
      label: "Claude-CN 实时入口经过 Model-Switch",
      status: runtimeVerification
        && runtimeState.client?.settingsReadable
        && normalizeUrl(actualClientBaseUrl) === normalizeUrl(expectedClientBaseUrl) ? "pass" : "fail",
      detail: actualClientBaseUrl || "无法读取 Claude-CN 实时入口",
    },
    {
      id: "model-switch-takeover-token",
      label: "Model-Switch 已接管 Claude-CN 凭据",
      status: runtimeVerification && runtimeState.client?.authTokenManaged ? "pass" : "fail",
      detail: runtimeState.client?.authTokenManaged ? "使用 PROXY_MANAGED 占位符" : "接管占位符缺失",
    },
    {
      id: "model-switch-health",
      label: "Model-Switch 本地路由在线",
      status: runtimeVerification && runtimeState.modelSwitch?.reachable ? "pass" : "fail",
      detail: runtimeState.modelSwitch?.reachable ? proxyHop?.url : "本地健康检查失败",
    },
    {
      id: "model-switch-9router-route",
      label: "Model-Switch 当前供应商指向 9Router",
      status: runtimeVerification
        && runtimeState.modelSwitch?.databaseReadable
        && normalizeUrl(actualModelSwitchBaseUrl) === normalizeUrl(expectedRouterBaseUrl) ? "pass" : "fail",
      detail: actualModelSwitchBaseUrl || "无法读取 Model-Switch 当前供应商",
    },
  ];

  return {
    schemaVersion: config.schemaVersion,
    chain: config.chain,
    responseRules: config.responseRules,
    documents: config.documents,
    actualProviderNode: publicNode,
    runtimeEvidence: {
      client: runtimeState.client || null,
      modelSwitch: runtimeState.modelSwitch || null,
    },
    checks,
    healthy: checks.every((check) => check.status === "pass"),
    checkedAt: now().toISOString(),
  };
}
