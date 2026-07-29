# RTK (Request Token Killer)

## Purpose

Pre-translate hooks that compress `tool_result` content in-place to cut token usage.

## Fail-Open Rule

RTK code must **never throw**. Any error returns `null` and leaves the body untouched.

```javascript
try {
  // compression logic
  return compressedBody;
} catch (e) {
  console.warn("[RTK]", e.message);
  return null; // fail-open: caller continues with original body
}
```

## Content Safety

- Skip `is_error` / `status:"error"` tool results — error traces should be preserved
- Only compress `tool_result` blocks (where the tool's output text lives)
- Per-tool compressors in `open-sse/rtk/filters/` (buildOutput, gitDiff, gitLog, grep, ls, tree, etc.)

Reference: `open-sse/rtk/index.js`, `open-sse/rtk/filters/` (12 files), `open-sse/rtk/autoDetect.js`

## Structure

- `index.js` — `compressMessages()` entry point
- `caveman.js` — optional terse system prompt
- `headroom.js` — external compression proxy
- `pxpipe.js` — pipe-through compression
- `ponytail.js` — truncation filter
- `filters/` — per-content-type compressors

## Testing

RTK filters should be easy to test individually — they take a string and return a string (or null). Unit tests in `tests/unit/`.

## Anti-patterns

- Never throw out of RTK code — the entire system is designed to work without compression
- Do not skip `status:"error"` results (already handled in index.js — don't re-introduce them)