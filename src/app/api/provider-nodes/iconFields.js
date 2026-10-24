// Shared server-side sanitizer for the UI-only icon fields on provider nodes.
//
// `icon` is either a preset provider id (e.g. "openai" → /providers/openai.png)
// or a `data:` URL for a user-uploaded image. Any other shape (remote URL,
// object, ...) is dropped to keep the DB clean and avoid SSRF/stored-URL risks.
//
// Three-state return per field, so callers can tell "preserve" from "clear":
//   - undefined  → field was absent in the request (caller: leave DB value as-is)
//   - null       → client asked to clear it (icon: "" / null / invalid)
//   - string     → sanitized value to store

// Max size of an uploaded icon once encoded as a data URL (~512KB). Client-side
// resize keeps real payloads far below this; the cap is a hard guard against
// accidental huge payloads in the DB.
const MAX_ICON_DATA_URL_BYTES = 512 * 1024;

function cleanColor(c) {
  if (typeof c !== "string") return undefined;
  const v = c.trim();
  if (!v) return null;
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(v) ? v : null;
}

function cleanTextIcon(t) {
  if (typeof t !== "string") return undefined;
  const v = t.trim();
  if (!v) return null;
  return v.slice(0, 4);
}

export function sanitizeIconFields(body) {
  const out = { icon: undefined, iconColor: undefined, textIcon: undefined };
  if (!body || typeof body !== "object") return out;

  // icon: absent → undefined; null/empty/invalid → null; valid → value
  if (body.icon !== undefined) {
    if (body.icon === null || body.icon === "") {
      out.icon = null;
    } else if (typeof body.icon === "string") {
      const v = body.icon.trim();
      if (!v) {
        out.icon = null;
      } else if (v.startsWith("data:image/")) {
        if (v.length > MAX_ICON_DATA_URL_BYTES) {
          throw new Error("Icon image is too large (max 512KB after encoding)");
        }
        out.icon = v;
      } else if (/^[A-Za-z0-9][A-Za-z0-9-_]*$/.test(v)) {
        // preset provider id → resolves to /providers/{v}.png
        out.icon = v;
      } else {
        // unrecognized shape → clear rather than persist junk
        out.icon = null;
      }
    } else {
      out.icon = null;
    }
  }

  out.iconColor = cleanColor(body.iconColor);
  out.textIcon = cleanTextIcon(body.textIcon);

  return out;
}
