"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  HermesContextLengthError,
  normalizeHermesContextLength,
  parseHermesModelBlock,
  removeHermesModelBlock,
  resolveHermesContextLength,
  upsertHermesModelBlock,
} from "@/lib/hermesConfig";

const execAsync = promisify(exec);

const PROVIDER_NAME = "9router";
const API_KEY_ENV = "OPENAI_API_KEY";

const getHermesDir = () => path.join(os.homedir(), ".hermes");
const getHermesConfigPath = () => path.join(getHermesDir(), "config.yaml");
const getHermesEnvPath = () => path.join(getHermesDir(), ".env");

// .env helpers — upsert/remove single KEY=VALUE line
const upsertEnvVar = (envText, key, value) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (re.test(envText)) return envText.replace(re, line);
  return envText.length > 0 && !envText.endsWith("\n") ? `${envText}\n${line}\n` : `${envText}${line}\n`;
};

const checkHermesInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where hermes" : "which hermes";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getHermesConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readConfigYaml = async () => {
  try {
    return await fs.readFile(getHermesConfigPath(), "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
};

const readEnvFile = async () => {
  try {
    return await fs.readFile(getHermesEnvPath(), "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
};

// Detect 9router by base_url containing localhost/127.0.0.1 or matching tunnel URL
const has9RouterConfig = (modelCfg) => {
  if (!modelCfg?.base_url) return false;
  return modelCfg.provider === "custom" && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(modelCfg.base_url);
};

export async function GET() {
  try {
    const installed = await checkHermesInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, settings: null, message: "Hermes Agent is not installed" });
    }
    const yaml = await readConfigYaml();
    const model = parseHermesModelBlock(yaml);
    return NextResponse.json({
      installed: true,
      settings: { model },
      has9Router: has9RouterConfig(model),
      configPath: getHermesConfigPath(),
    });
  } catch (error) {
    console.log("Error checking hermes settings:", error);
    return NextResponse.json({ error: "Failed to check hermes settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey, model } = body;
    if (!baseUrl || !model) {
      return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
    }

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

    const existingYaml = await readConfigYaml();
    const existingModel = parseHermesModelBlock(existingYaml);
    const hasContextLength = Object.prototype.hasOwnProperty.call(body, "contextLength");
    let contextLength;
    try {
      contextLength = resolveHermesContextLength({
        value: body.contextLength,
        hasValue: hasContextLength,
        existingModel,
        model,
        provider: "custom",
        baseUrl: normalizedBaseUrl,
      });
    } catch (error) {
      if (error instanceof HermesContextLengthError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const dir = getHermesDir();
    await fs.mkdir(dir, { recursive: true });

    const newYaml = upsertHermesModelBlock(existingYaml, {
      default: model,
      provider: "custom",
      base_url: normalizedBaseUrl,
      api_key: "${OPENAI_API_KEY}",
      context_length: contextLength,
    });
    await fs.writeFile(getHermesConfigPath(), newYaml);

    // Update .env — upsert OPENAI_API_KEY only when caller provides one
    if (apiKey) {
      const existingEnv = await readEnvFile();
      const newEnv = upsertEnvVar(existingEnv, API_KEY_ENV, apiKey);
      await fs.writeFile(getHermesEnvPath(), newEnv);
    }

    return NextResponse.json({
      success: true,
      message: "Hermes settings applied successfully!",
      configPath: getHermesConfigPath(),
      contextLength: contextLength === undefined ? existingModel?.context_length ?? null : contextLength,
    });
  } catch (error) {
    console.log("Error updating hermes settings:", error);
    return NextResponse.json({ error: "Failed to update hermes settings" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    if (!Object.prototype.hasOwnProperty.call(body, "contextLength")) {
      return NextResponse.json({ error: "contextLength is required" }, { status: 400 });
    }

    let contextLength;
    try {
      contextLength = normalizeHermesContextLength(body.contextLength);
    } catch (error) {
      if (error instanceof HermesContextLengthError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const existingYaml = await readConfigYaml();
    const existingModel = parseHermesModelBlock(existingYaml);
    if (!existingModel?.default || !existingModel?.base_url) {
      return NextResponse.json({ error: "Hermes 9Router model configuration is not set" }, { status: 400 });
    }

    const newYaml = upsertHermesModelBlock(existingYaml, { context_length: contextLength });
    await fs.writeFile(getHermesConfigPath(), newYaml);

    return NextResponse.json({
      success: true,
      message: "Hermes context length updated successfully!",
      configPath: getHermesConfigPath(),
      contextLength,
    });
  } catch (error) {
    console.log("Error updating hermes context length:", error);
    return NextResponse.json({ error: "Failed to update hermes context length" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getHermesConfigPath();
    let yaml = "";
    try {
      yaml = await fs.readFile(configPath, "utf-8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw error;
    }
    const newYaml = removeHermesModelBlock(yaml);
    await fs.writeFile(configPath, newYaml);
    return NextResponse.json({ success: true, message: `${PROVIDER_NAME} model block removed` });
  } catch (error) {
    console.log("Error resetting hermes settings:", error);
    return NextResponse.json({ error: "Failed to reset hermes settings" }, { status: 500 });
  }
}
