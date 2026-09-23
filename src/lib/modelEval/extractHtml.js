// Pull the deliverable out of a model reply: models wrap code in a fence,
// answer with bare markup, or bury it in prose. Unterminated fences are common
// when max_tokens truncates mid-file, so an open fence is treated as "rest of text".

const FENCE_RE = /^[ \t]*```[ \t]*([a-zA-Z0-9+#.-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```/gm;
const OPEN_FENCE_RE = /^[ \t]*```[ \t]*([a-zA-Z0-9+#.-]*)[ \t]*\r?\n([\s\S]*)$/m;

const HTMLISH_LANGS = new Set(["html", "svg", "xml", "htm", "xhtml"]);

function looksLikeMarkup(text) {
  return /<(?:!doctype\s+html|html[\s>]|svg[\s/>]|body[\s>]|div[\s>]|script[\s>]|style[\s>])/i.test(text);
}

function trimToTag(text, openRe, closeRe) {
  const open = openRe.exec(text);
  if (!open) return null;
  const close = closeRe.exec(text.slice(open.index + open[0].length));
  const end = close ? open.index + open[0].length + close.index + close[0].length : text.length;
  return text.slice(open.index, end).trim();
}

// Returns the extracted markup, or null when the reply carries nothing renderable.
export function extractCode(raw) {
  const text = String(raw ?? "");
  if (!text.trim()) return null;

  const fenced = [];
  FENCE_RE.lastIndex = 0;
  let match;
  while ((match = FENCE_RE.exec(text)) !== null) {
    fenced.push({ lang: (match[1] || "").toLowerCase(), body: match[2] });
  }
  if (fenced.length) {
    const byLang = fenced.find((f) => HTMLISH_LANGS.has(f.lang) && f.body.trim());
    const markup = fenced.find((f) => looksLikeMarkup(f.body) && f.body.trim());
    const longest = fenced.slice().sort((a, b) => b.body.length - a.body.length)[0];
    const pick = byLang || markup || (longest?.body.trim() ? longest : null);
    if (pick?.body.trim()) return pick.body.trim();
  }

  // Truncated reply: fence opened, never closed.
  OPEN_FENCE_RE.lastIndex = 0;
  const open = OPEN_FENCE_RE.exec(text);
  if (open && open[2].trim()) {
    const body = open[2].trim();
    const tail = trimToTag(body, /<!doctype\s+html|<html[\s>]/i, /<\/html>/i)
      || trimToTag(body, /<svg[\s/>]/i, /<\/svg>/i);
    return tail || body;
  }

  return trimToTag(text, /<!doctype\s+html|<html[\s>]/i, /<\/html>/i)
    || trimToTag(text, /<svg[\s/>]/i, /<\/svg>/i)
    || null;
}
