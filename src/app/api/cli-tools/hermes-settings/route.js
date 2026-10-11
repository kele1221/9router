"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import {
  HermesContextLengthError,
  normalizeHermesContextLength,
  parseHermesModelBlock,
  resolveHermesContextLength,
  upsertHermesModelBlock,
} from "@/lib/hermesConfig";

import {
  buildDelegationBlock,
  buildAuxRoleBlock,
  parseDelegationBlock,
  parseAuxRoles,
  upsertDelegationBlock,
  upsertAuxRole,
  removeDelegationBlock,
  removeAuxRole,
  upsertEnvVar,
  has9RouterConfig,
  isCustomBlock,
  removeModelBlock,
} from "./hermesYaml.js";
import { resolveHermesHome, listProfiles, dirExists } from "./hermesProfiles.js";

const execAsync = promisify(exec);

const PROVIDER_NAME = "9router";
const API_KEY_ENV = "OPENAI_API_KEY";

// Profile comes from ?profile= on GET (all-statuses calls GET() with no argument at all,
// so every reader must tolerate a missing request) and from the JSON body on POST/DELETE.
// POST/DELETE fall back to the query string — callers reach for either.
const getQueryParam = (request, key) => {
  if (!request) return null;
  try {
    const url = request.nextUrl || (typeof request.url === "string" ? new URL(request.url) : null);
    return url?.searchParams?.get(key) || null;
  } catch {
    return null;
  }
};

const getProfileParam = (request) => getQueryParam(request, "profile");

const truthy = (value) => value === true || value === "true" || value === "1";

const resolveHome = (profile) => {
  try {
    return { home: resolveHermesHome(profile) };
  } catch (error) {
    return { error: error.message };
  }
};

const readTextFile = async (file) => {
  try {
    return await fs.readFile(file, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
};

const readConfigYaml = (home) => readTextFile(home.configPath);
const readEnvFile = (home) => readTextFile(home.envPath);

// Named profile homes are created by `hermes profile create` — never by us: a directory
// without identity files is not a profile, and we must not fabricate one.
const writeHomeConfig = async (home, yaml) => {
  if (home.isDefault) await fs.mkdir(home.dir, { recursive: true });
  await fs.writeFile(home.configPath, yaml);
};

// Only ever upserts the OPENAI_API_KEY line — per-profile .env files also carry bot tokens
// and messaging-channel credentials that must stay untouched.
const writeHomeEnv = async (home, apiKey) => {
  if (!apiKey) return;
  if (home.isDefault) await fs.mkdir(home.dir, { recursive: true });
  const env = upsertEnvVar(await readEnvFile(home), API_KEY_ENV, apiKey);
  await fs.writeFile(home.envPath, env);
};

const checkHermesInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where hermes" : "which hermes";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(resolveHermesHome(null).configPath);
      return true;
    } catch {
      return false;
    }
  }
};

// Resolve the context-length override for one profile. Throws HermesContextLengthError on
// invalid input so callers can answer 400 without writing anything.
const resolveContextLengthFor = ({ existingModel, model, hasValue, value, baseUrl }) =>
  resolveHermesContextLength({
    value,
    hasValue,
    existingModel,
    model,
    provider: "custom",
    baseUrl,
  });

export async function GET(request) {
  try {
    const installed = await checkHermesInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, settings: null, message: "Hermes Agent is not installed" });
    }

    const { home, error } = resolveHome(getProfileParam(request));
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (!home.isDefault && !(await dirExists(home.dir))) {
      return NextResponse.json({ error: `Hermes profile "${home.name}" not found` }, { status: 404 });
    }

    const yaml = await readConfigYaml(home);
    const model = parseHermesModelBlock(yaml);
    const delegation = parseDelegationBlock(yaml);
    const auxiliary = parseAuxRoles(yaml);
    return NextResponse.json({
      installed: true,
      profile: { name: home.name, dir: home.dir, isDefault: home.isDefault },
      settings: { model, delegation, auxiliary },
      has9Router: has9RouterConfig(model) || has9RouterConfig(delegation) || Object.values(auxiliary).some(has9RouterConfig),
      configPath: home.configPath,
    });
  } catch (error) {
    console.log("Error checking hermes settings:", error);
    return NextResponse.json({ error: "Failed to check hermes settings" }, { status: 500 });
  }
}

// Endpoint + API key across every profile: refresh the 9router blocks each profile already
// has (models stay per-profile), and wire up profiles that have no main model yet using the
// model chosen in this request. Profiles on another provider are reported, never rewritten.
const applyToAllProfiles = async ({ normalizedBaseUrl, apiKey, model, contextLength }) => {
  const profiles = await listProfiles();
  const results = [];
  for (const profile of profiles) {
    const home = resolveHermesHome(profile.name);
    try {
      let yaml = await readConfigYaml(home);
      const main = parseHermesModelBlock(yaml);

      if (main?.default && isCustomBlock(main)) {
        yaml = upsertHermesModelBlock(yaml, {
          default: main.default,
          provider: "custom",
          base_url: normalizedBaseUrl,
          api_key: "${OPENAI_API_KEY}",
          // An unchanged endpoint keeps this profile's override (undefined → untouched).
          context_length: resolveContextLengthFor({
            existingModel: main,
            model: main.default,
            hasValue: contextLength.hasValue,
            value: contextLength.value,
            baseUrl: normalizedBaseUrl,
          }),
        });
        const delegation = parseDelegationBlock(yaml);
        if (delegation?.model && isCustomBlock(delegation)) {
          yaml = upsertDelegationBlock(yaml, buildDelegationBlock(delegation.model, normalizedBaseUrl));
        }
        for (const [role, cfg] of Object.entries(parseAuxRoles(yaml))) {
          if (cfg?.model && isCustomBlock(cfg)) {
            yaml = upsertAuxRole(yaml, role, buildAuxRoleBlock(role, cfg.model, normalizedBaseUrl));
          }
        }
        await writeHomeConfig(home, yaml);
        await writeHomeEnv(home, apiKey);
        results.push({ profile: profile.name, status: "updated", model: main.default });
      } else if (main?.default) {
        results.push({
          profile: profile.name,
          status: "skipped",
          reason: `main model uses provider "${main.provider || "unknown"}" — configure this profile individually`,
        });
      } else if (model) {
        const newContextLength = resolveContextLengthFor({
          existingModel: main,
          model,
          hasValue: contextLength.hasValue,
          value: contextLength.value,
          baseUrl: normalizedBaseUrl,
        });
        yaml = upsertHermesModelBlock(yaml, {
          default: model,
          provider: "custom",
          base_url: normalizedBaseUrl,
          api_key: "${OPENAI_API_KEY}",
          context_length: newContextLength,
        });
        await writeHomeConfig(home, yaml);
        await writeHomeEnv(home, apiKey);
        results.push({ profile: profile.name, status: "updated", model });
      } else {
        results.push({ profile: profile.name, status: "skipped", reason: "no main model configured" });
      }
    } catch (error) {
      results.push({ profile: profile.name, status: "failed", reason: error.message });
    }
  }
  const updated = results.filter((r) => r.status === "updated").length;
  return NextResponse.json({
    success: updated > 0,
    bulk: true,
    results,
    updated,
    skipped: results.length - updated,
    message: `Updated endpoint on ${updated} profile(s)`,
  });
};

export async function POST(request) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey, model, selections } = body;
    // selections: [{role, model}] — "default" plus any auxiliary/delegation slots.
    // Legacy callers (CLI quick setup) send a bare `model` → treat as default role.
    const sel = Array.isArray(selections) && selections.some((s) => s?.role && s?.model)
      ? selections.filter((s) => s?.role && s?.model)
      : model ? [{ role: "default", model }] : [];
    const defaultSel = sel.find((s) => s.role === "default");
    if (!baseUrl || !defaultSel) {
      return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
    }

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

    const contextLength = {
      hasValue: Object.prototype.hasOwnProperty.call(body, "contextLength"),
      value: body.contextLength,
    };

    if (truthy(body.applyToAll ?? getQueryParam(request, "applyToAll"))) {
      return await applyToAllProfiles({ normalizedBaseUrl, apiKey, model: defaultSel.model, contextLength });
    }

    // Profile target: JSON body first, then ?profile= — callers reach for either.
    const { home, error } = resolveHome(body.profile ?? getProfileParam(request));
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (!home.isDefault && !(await dirExists(home.dir))) {
      return NextResponse.json({ error: `Hermes profile "${home.name}" not found` }, { status: 404 });
    }

    const existingYaml = await readConfigYaml(home);
    const existingModel = parseHermesModelBlock(existingYaml);
    let resolvedContextLength;
    try {
      resolvedContextLength = resolveContextLengthFor({
        existingModel,
        model: defaultSel.model,
        ...contextLength,
        baseUrl: normalizedBaseUrl,
      });
    } catch (error) {
      if (error instanceof HermesContextLengthError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    // Update config.yaml — upsert each role block, keep everything else
    let newYaml = existingYaml;
    for (const { role, model: roleModel } of sel) {
      if (role === "default") {
        newYaml = upsertHermesModelBlock(newYaml, {
          default: roleModel,
          provider: "custom",
          base_url: normalizedBaseUrl,
          api_key: "${OPENAI_API_KEY}",
          context_length: resolvedContextLength,
        });
      } else if (role === "delegation") {
        newYaml = upsertDelegationBlock(newYaml, buildDelegationBlock(roleModel, normalizedBaseUrl));
      } else {
        newYaml = upsertAuxRole(newYaml, role, buildAuxRoleBlock(role, roleModel, normalizedBaseUrl));
      }
    }
    await writeHomeConfig(home, newYaml);

    // Update .env — upsert OPENAI_API_KEY only when caller provides one
    await writeHomeEnv(home, apiKey);

    return NextResponse.json({
      success: true,
      message: home.isDefault ? "Hermes settings applied successfully!" : `Hermes settings applied to profile "${home.name}"!`,
      profile: { name: home.name, dir: home.dir, isDefault: home.isDefault },
      configPath: home.configPath,
      contextLength: resolvedContextLength === undefined ? existingModel?.context_length ?? null : resolvedContextLength,
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

    const { home, error } = resolveHome(body.profile ?? getProfileParam(request));
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (!home.isDefault && !(await dirExists(home.dir))) {
      return NextResponse.json({ error: `Hermes profile "${home.name}" not found` }, { status: 404 });
    }

    const existingYaml = await readConfigYaml(home);
    const existingModel = parseHermesModelBlock(existingYaml);
    if (!existingModel?.default || !existingModel?.base_url) {
      return NextResponse.json({ error: "Hermes 9Router model configuration is not set" }, { status: 400 });
    }

    const newYaml = upsertHermesModelBlock(existingYaml, { context_length: contextLength });
    await writeHomeConfig(home, newYaml);

    return NextResponse.json({
      success: true,
      message: "Hermes context length updated successfully!",
      profile: { name: home.name, dir: home.dir, isDefault: home.isDefault },
      configPath: home.configPath,
      contextLength,
    });
  } catch (error) {
    console.log("Error updating hermes context length:", error);
    return NextResponse.json({ error: "Failed to update hermes context length" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    let body = null;
    if (request && typeof request.json === "function") {
      try {
        body = await request.json();
      } catch {
        body = null; // CLI reset sends an empty body → default profile
      }
    }

    const { home, error } = resolveHome(body?.profile ?? getProfileParam(request));
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (!home.isDefault && !(await dirExists(home.dir))) {
      return NextResponse.json({ error: `Hermes profile "${home.name}" not found` }, { status: 404 });
    }

    let yaml = "";
    try {
      yaml = await fs.readFile(home.configPath, "utf-8");
    } catch (readError) {
      if (readError.code === "ENOENT") {
        return NextResponse.json({ success: true, profile: home.name, message: "No config file to reset" });
      }
      throw readError;
    }

    // Only drop blocks 9router wrote (custom provider) — a model/delegation/aux block owned
    // by another provider is this profile's own configuration and must survive a reset.
    const removed = { model: false, delegation: false, auxiliary: [] };
    const kept = [];

    const main = parseHermesModelBlock(yaml);
    if (main && isCustomBlock(main)) {
      yaml = removeModelBlock(yaml);
      removed.model = true;
    } else if (main) {
      kept.push("model");
    }

    const delegation = parseDelegationBlock(yaml);
    if (delegation && isCustomBlock(delegation)) {
      yaml = removeDelegationBlock(yaml);
      removed.delegation = true;
    } else if (delegation) {
      kept.push("delegation");
    }

    for (const [role, cfg] of Object.entries(parseAuxRoles(yaml))) {
      if (isCustomBlock(cfg)) {
        yaml = removeAuxRole(yaml, role);
        removed.auxiliary.push(role);
      }
    }

    yaml = yaml.replace(/^\n+/, "");
    await writeHomeConfig(home, yaml);

    const scope = home.isDefault ? "" : ` in profile "${home.name}"`;
    return NextResponse.json({
      success: true,
      profile: home.name,
      removed,
      kept,
      message: `${PROVIDER_NAME} model blocks removed${scope}`,
    });
  } catch (error) {
    console.log("Error resetting hermes settings:", error);
    return NextResponse.json({ error: "Failed to reset hermes settings" }, { status: 500 });
  }
}
