// Shared "is this pickable model disabled?" helpers for the model selectors.
// disabledModels is the /api/models/disabled map, keyed by storage alias OR raw
// provider id, with model ids as values.
import { getProviderAlias } from "@/shared/constants/providers";

function splitModelValue(value) {
  const text = String(value || "");
  const slash = text.indexOf("/");
  if (slash <= 0) return { prefix: text, modelId: null };
  return { prefix: text.slice(0, slash), modelId: text.slice(slash + 1) };
}

export function disabledModelIdsFor(disabledModels, prefix) {
  if (!disabledModels || !prefix) return [];
  const alias = getProviderAlias(prefix) || prefix;
  return [
    ...(disabledModels[prefix] || []),
    ...(alias !== prefix ? (disabledModels[alias] || []) : []),
  ];
}

export function isModelDisabled(disabledModels, value) {
  const { prefix, modelId } = splitModelValue(value);
  if (!modelId) return false;
  return disabledModelIdsFor(disabledModels, prefix).includes(modelId);
}

// A combo whose every member is disabled has nothing left to route to, so the
// pickers hide it. Partially disabled combos stay visible: they still work
// through their healthy members (fallback / round-robin).
export function isComboFullyDisabled(combo, disabledModels) {
  const models = Array.isArray(combo?.models) ? combo.models : [];
  if (models.length === 0) return false;
  return models.every((value) => isModelDisabled(disabledModels, value));
}
