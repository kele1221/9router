// Provider icon paths under /public/providers.
// Alias related brands; session-cache 404s so one miss never spams again.

const ICON_ALIASES = {
  "perplexity-agent": "perplexity",
  "gitlab-duo": "gitlab",
  "vercel-ai-gateway": "vercel",
  "ollama-search": "ollama",
  // MiniMax Code rides the existing MiniMax brand mark
  "minimax-code": "minimax",
  "minimax-code-global": "minimax",
};

// Runtime only — first 404 remembers id for the whole session
const failedIds = new Set();

function normalizeId(providerId) {
  if (!providerId || typeof providerId !== "string") return "";
  return providerId.trim().toLowerCase();
}

/** Resolve icon file id (after alias). Empty if previously failed this session. */
export function resolveProviderIconId(providerId) {
  const id = normalizeId(providerId);
  if (!id) return "";
  if (failedIds.has(id)) return "";
  const aliased = ICON_ALIASES[id] || id;
  if (failedIds.has(aliased)) return "";
  return aliased;
}

/** `/providers/{id}.png` or null when previously failed. */
export function getProviderIconSrc(providerId) {
  const id = resolveProviderIconId(providerId);
  return id ? `/providers/${id}.png` : null;
}

/** Call from img onError so later mounts skip the request. */
export function markProviderIconMissing(providerId) {
  const id = normalizeId(providerId);
  if (id) failedIds.add(id);
  const aliased = ICON_ALIASES[id];
  if (aliased) failedIds.add(aliased);
}

/**
 * Resolve an icon value stored on a custom provider node.
 *
 * `icon` is one of:
 *   - a preset provider id (e.g. "openai")  → `/providers/{id}.png`
 *   - a `data:` URL (user-uploaded image)    → returned as-is
 *   - a full path like `/providers/foo.png`  → resolved (with 404 caching)
 *
 * Returns `null` when there is nothing usable so callers can fall back to the
 * category default icon / initials.
 */
export function resolveNodeIconSrc(icon) {
  if (typeof icon !== "string" || !icon.trim()) return null;
  const v = icon.trim();
  if (v.startsWith("data:")) return v;
  // Full /providers/{id}.png path
  const m = v.match(/^\/providers\/([^/]+)\.(png|svg)$/i);
  if (m) return getProviderIconSrc(m[1]);
  // Bare preset id
  if (/^[A-Za-z0-9][A-Za-z0-9-_]*$/.test(v)) return getProviderIconSrc(v);
  return null;
}

/**
 * Resolve the icon src for a custom provider node (OpenAI/Anthropic
 * compatible, custom embedding). Returns the user-uploaded data URL / preset
 * path when set, otherwise the generic brand mark for compatible nodes.
 * Returns `null` when there is nothing to render (caller falls back to the
 * node's textIcon badge), e.g. for custom-embedding nodes without an icon.
 */
export function resolveCustomProviderIcon(node) {
  if (!node) return null;
  const custom = resolveNodeIconSrc(node.icon);
  if (custom) return custom;
  if (node.type === "anthropic-compatible") return "/providers/anthropic-m.png";
  if (node.type === "openai-compatible") {
    return node.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
  }
  return null;
}
