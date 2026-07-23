import { RATE_LIMIT_ERROR_MARKER } from "open-sse/config/errorConfig.js";

function normalizeUrl(value) {
  return String(value || "").replace(/\/+$/, "");
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
  now = () => new Date(),
}) {
  const providerHop = config.chain.hops.find((hop) => hop.kind === "provider");
  const actualNode = providerNodes.find((node) => node.id === providerHop?.providerNodeId) || null;
  const publicNode = publicProviderNode(actualNode);
  const responseRule = config.responseRules.find((rule) => (
    rule.when?.status === 400
    && rule.when?.errorCodeOrType === RATE_LIMIT_ERROR_MARKER
    && rule.then?.effectiveStatus === 429
    && rule.then?.preserveBody === true
  ));

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
  ];

  return {
    schemaVersion: config.schemaVersion,
    chain: config.chain,
    responseRules: config.responseRules,
    documents: config.documents,
    actualProviderNode: publicNode,
    checks,
    healthy: checks.every((check) => check.status === "pass"),
    checkedAt: now().toISOString(),
  };
}
