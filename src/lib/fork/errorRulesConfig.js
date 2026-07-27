import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import templateConfig from "@/shared/config/error-rules.json";

const LOCAL_CONFIG_RELATIVE_PATH = path.join("fork", "error-rules.local.json");

function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Error rules config must be an object");
  if (!Array.isArray(config.errorRules)) throw new Error("errorRules must be an array");
  return config;
}

let _config = null;
let _reloadVersion = 0;

export async function loadErrorRulesConfig({
  dataDir = DATA_DIR,
  readFile = fs.readFile,
} = {}) {
  const localConfigPath = path.join(dataDir, LOCAL_CONFIG_RELATIVE_PATH);
  try {
    const contents = await readFile(localConfigPath, "utf8");
    const parsed = validateConfig(JSON.parse(contents));
    _config = {
      ...parsed,
      _localConfigPath: localConfigPath,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    _config = validateConfig(templateConfig);
  }
  _reloadVersion++;
  return _config;
}

export async function saveErrorRulesConfig(config, {
  dataDir = DATA_DIR,
  mkdir = fs.mkdir,
  writeFile = fs.writeFile,
} = {}) {
  const localConfigPath = path.join(dataDir, LOCAL_CONFIG_RELATIVE_PATH);
  const forkDir = path.join(dataDir, "fork");
  const validated = validateConfig(config);

  await mkdir(forkDir, { recursive: true });
  await writeFile(localConfigPath, JSON.stringify(validated, null, 2) + "\n", "utf8");
  _config = validated;
  _reloadVersion++;
  return _config;
}

export function getErrorRulesConfig() {
  if (!_config) {
    _config = validateConfig(templateConfig);
  }
  return _config;
}

export function getReloadVersion() {
  return _reloadVersion;
}

export function getLocalConfigRelativePath() {
  return LOCAL_CONFIG_RELATIVE_PATH;
}
