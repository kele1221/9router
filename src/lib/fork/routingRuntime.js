import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PROXY_TOKEN_PLACEHOLDER = "PROXY_MANAGED";

function expandHome(filePath, homeDir) {
  if (typeof filePath !== "string" || !filePath) return null;
  if (filePath === "~") return homeDir;
  if (filePath.startsWith("~/")) return path.join(homeDir, filePath.slice(2));
  return filePath;
}

function joinUrl(baseUrl, suffix) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const pathSuffix = String(suffix || "").replace(/^\/+/, "");
  if (!base) return null;
  return pathSuffix ? `${base}/${pathSuffix}` : base;
}

function isLoopbackHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function defaultOpenDatabase(databasePath) {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return new DatabaseSync(databasePath, { readOnly: true });
  } catch {
    const { default: Database } = await import("better-sqlite3");
    return new Database(databasePath, { readonly: true, fileMustExist: true });
  }
}

async function readClientState(config, { homeDir, readFile }) {
  const settingsPath = expandHome(config.runtimeVerification?.clientSettingsPath, homeDir);
  if (!settingsPath) {
    return { settingsReadable: false, baseUrl: null, authTokenManaged: false };
  }

  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const env = settings?.env && typeof settings.env === "object" ? settings.env : {};
    return {
      settingsReadable: true,
      baseUrl: typeof env.ANTHROPIC_BASE_URL === "string" ? env.ANTHROPIC_BASE_URL : null,
      authTokenManaged: env.ANTHROPIC_AUTH_TOKEN === PROXY_TOKEN_PLACEHOLDER
        || env.ANTHROPIC_API_KEY === PROXY_TOKEN_PLACEHOLDER,
    };
  } catch {
    return { settingsReadable: false, baseUrl: null, authTokenManaged: false };
  }
}

async function readModelSwitchProvider(config, { homeDir, openDatabase }) {
  const databasePath = expandHome(config.runtimeVerification?.modelSwitchDatabasePath, homeDir);
  const appType = config.runtimeVerification?.modelSwitchAppType;
  if (!databasePath || !appType) {
    return { databaseReadable: false, currentProvider: null };
  }

  let database;
  try {
    database = await openDatabase(databasePath);
    const row = database.prepare(`
      SELECT id, name, settings_config
      FROM providers
      WHERE app_type = ? AND is_current = 1
      ORDER BY sort_index ASC
      LIMIT 1
    `).get(appType);
    if (!row) return { databaseReadable: true, currentProvider: null };

    const providerConfig = JSON.parse(row.settings_config);
    const baseUrl = providerConfig?.env?.ANTHROPIC_BASE_URL;
    return {
      databaseReadable: true,
      currentProvider: {
        id: row.id,
        name: row.name,
        baseUrl: typeof baseUrl === "string" ? baseUrl : null,
      },
    };
  } catch {
    return { databaseReadable: false, currentProvider: null };
  } finally {
    database?.close();
  }
}

async function checkModelSwitchHealth(config, fetchImpl) {
  const proxyHop = config.chain?.hops?.find((hop) => hop.kind === "proxy");
  const healthUrl = joinUrl(proxyHop?.url, "/health");
  if (!healthUrl || !isLoopbackHttpUrl(healthUrl)) return false;

  try {
    const response = await fetchImpl(healthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function loadRoutingRuntimeState(config, {
  homeDir = os.homedir(),
  readFile = fs.readFile,
  openDatabase = defaultOpenDatabase,
  fetchImpl = globalThis.fetch,
} = {}) {
  const [client, modelSwitchProvider, reachable] = await Promise.all([
    readClientState(config, { homeDir, readFile }),
    readModelSwitchProvider(config, { homeDir, openDatabase }),
    checkModelSwitchHealth(config, fetchImpl),
  ]);

  return {
    client,
    modelSwitch: {
      ...modelSwitchProvider,
      reachable,
    },
  };
}
