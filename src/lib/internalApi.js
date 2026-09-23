// Shared helper for calling this app's own /api/v1 endpoints from server code
// (model test pings, capability evaluation runs). The x-9r-cli-token header is
// what dashboardGuard.js accepts for loopback CLI/self calls.
//
// NOTE: imports use these exact paths (@/lib/localDb, @/shared/constants/config,
// @/shared/utils/machineId) because existing unit tests mock those specifiers.
import { getApiKeys } from "@/lib/localDb";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_SALT = "9r-cli-auth";

export function getInternalBaseUrl(override) {
  return override || `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
}

export async function getInternalHeaders() {
  let apiKey = null;
  try {
    const keys = await getApiKeys();
    apiKey = keys.find((k) => k.isActive !== false)?.key || null;
  } catch {}

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);
  return headers;
}
