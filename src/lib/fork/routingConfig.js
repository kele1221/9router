import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import templateConfig from "@/shared/config/routing-chains.json";

const LOCAL_CONFIG_RELATIVE_PATH = path.join("fork", "routing-chains.local.json");

function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Routing config must be an object");
  if (!Array.isArray(config.chain?.hops)) throw new Error("Routing config must define chain.hops");
  if (!Array.isArray(config.responseRules)) throw new Error("Routing config must define responseRules");
  if (!Array.isArray(config.documents)) throw new Error("Routing config must define documents");
  return config;
}

export async function loadRoutingConfig({
  dataDir = DATA_DIR,
  readFile = fs.readFile,
} = {}) {
  const localConfigPath = path.join(dataDir, LOCAL_CONFIG_RELATIVE_PATH);
  try {
    const contents = await readFile(localConfigPath, "utf8");
    return {
      config: validateConfig(JSON.parse(contents)),
      source: "local",
      localConfigRelativePath: LOCAL_CONFIG_RELATIVE_PATH,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      config: validateConfig(templateConfig),
      source: "template",
      localConfigRelativePath: LOCAL_CONFIG_RELATIVE_PATH,
    };
  }
}
