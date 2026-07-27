import {
  loadErrorRulesConfig,
  saveErrorRulesConfig,
  getErrorRulesConfig,
  getReloadVersion,
  getLocalConfigRelativePath,
} from "@/lib/fork/errorRulesConfig.js";
import { setRuntimeErrorConfig } from "open-sse/config/errorConfig.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/fork/error-rules
 * Returns the currently effective error rules configuration.
 */
export async function GET() {
  try {
    const config = getErrorRulesConfig();
    return Response.json({
      config,
      source: config._localConfigPath ? "local" : "template",
      localConfigRelativePath: getLocalConfigRelativePath(),
      reloadVersion: getReloadVersion(),
    });
  } catch (error) {
    console.error("[error-rules] GET failed:", error);
    return Response.json(
      { error: "Failed to load error rules configuration" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/fork/error-rules
 * Replace the error rules config (writes to DATA_DIR/fork/error-rules.local.json)
 * and hot-reloads into the running process.
 */
export async function PUT(request) {
  try {
    const body = await request.json();
    const saved = await saveErrorRulesConfig(body);
    setRuntimeErrorConfig(saved);
    return Response.json({
      config: saved,
      source: "local",
      localConfigRelativePath: getLocalConfigRelativePath(),
      reloadVersion: getReloadVersion(),
    });
  } catch (error) {
    console.error("[error-rules] PUT failed:", error);
    return Response.json(
      { error: `Failed to save error rules: ${error.message}` },
      { status: 400 },
    );
  }
}