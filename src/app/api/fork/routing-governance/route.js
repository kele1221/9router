import { getProviderNodes } from "@/lib/localDb.js";
import { buildRoutingGovernanceStatus } from "@/lib/fork/routingGovernance.js";
import { loadRoutingConfig } from "@/lib/fork/routingConfig.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [providerNodes, routingConfig] = await Promise.all([
      getProviderNodes(),
      loadRoutingConfig(),
    ]);
    const status = buildRoutingGovernanceStatus({
      config: routingConfig.config,
      providerNodes,
    });
    return Response.json({
      ...status,
      configSource: routingConfig.source,
      localConfigRelativePath: routingConfig.localConfigRelativePath,
    });
  } catch (error) {
    console.error("[routing-governance] validation failed:", error);
    return Response.json({
      healthy: false,
      checkedAt: new Date().toISOString(),
      error: "无法读取本地路由配置",
    }, { status: 500 });
  }
}
