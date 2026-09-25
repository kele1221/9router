// Expands model-evaluation selections into runnable model × reasoning targets.
// Combos are accepted only when every possible member supports the chosen level,
// keeping a matrix cell's meaning stable across fallback routing.
import { getComboModels, getModelInfo } from "@/sse/services/model.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";

export const EVAL_THINKING_EFFORTS = ["none", "low", "medium", "high"];
export const MAX_EVAL_TARGETS = 50;

export function normalizeThinkingEfforts(value, { defaultNone = true } = {}) {
  const efforts = [...new Set((Array.isArray(value) ? value : [])
    .map((effort) => String(effort || "").trim())
    .filter((effort) => EVAL_THINKING_EFFORTS.includes(effort)))];
  return efforts.length || !defaultNone ? efforts : ["none"];
}

async function supportsThinkingEffort(model, effort) {
  if (effort === "none") return true;
  const members = await getComboModels(model) || [model];
  for (const member of members) {
    const info = await getModelInfo(member);
    const levels = info?.provider && info?.model ? getThinkingLevels(info.provider, info.model) : null;
    if (!levels?.includes(effort)) return false;
  }
  return true;
}

export async function expandThinkingTargets(models, thinkingEfforts) {
  const targets = [];
  const skipped = [];
  for (const model of models) {
    for (const thinkingEffort of thinkingEfforts) {
      if (await supportsThinkingEffort(model, thinkingEffort)) targets.push({ model, thinkingEffort });
      else skipped.push({ model, thinkingEffort });
    }
  }
  return { targets, skipped };
}
