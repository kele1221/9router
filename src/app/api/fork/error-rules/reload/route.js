import {
  loadErrorRulesConfig,
  getErrorRulesConfig,
  getReloadVersion,
  getLocalConfigRelativePath,
} from "@/lib/fork/errorRulesConfig.js";
import { setRuntimeErrorConfig } from "open-sse/config/errorConfig.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/fork/error-rules/reload
 * Re-read the error-rules config from disk and hot-reload into the running process.
 */
export async function POST() {
  try {
    const config = await loadErrorRulesConfig();
    setRuntimeErrorConfig(config);
    return Response.json({
      config,
      source: config._localConfigPath ? "local" : "template",
      localConfigRelativePath: getLocalConfigRelativePath(),
      reloadVersion: getReloadVersion(),
    });
  } catch (error) {
    console.error("[error-rules] reload failed:", error);
    return Response.json(
      { error: `Reload failed: ${error.message}` },
      { status: 500 },
    );
  }
}