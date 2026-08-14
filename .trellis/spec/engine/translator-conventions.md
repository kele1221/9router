# Translator Conventions

## How Translators Work

The translation engine pivots through **OpenAI as the intermediate format**. Pseudo-code:

```
source → openai → target   (standard double-hop)
source → target             (direct route, lossless)
```

## Registration Pattern

Each translator file self-registers via `register()` as a side-effect import:

```javascript
import { register } from "../index.js";

register(FORMATS.SOURCE, FORMATS.TARGET, requestFn, responseFn);
```

Both `requestFn` and `responseFn` are optional — register only the directions you implement.

Reference: `open-sse/translator/formats.js` (FORMATS map), `open-sse/translator/index.js` (register function)

## Adding a Translator

1. Create `open-sse/translator/request/<from>-to-<to>.js` (or `open-sse/translator/response/`)
2. Call `register(FORMATS.X, FORMATS.Y, reqFn, resFn)` as module-level side effect
3. Add a static import at the bottom of `open-sse/translator/index.js` (lines 271-293)

Reference: `open-sse/translator/index.js` lines 271-293 — current import list

## Schema Constants

Never hardcode role/block/model strings. Use schema enums from `open-sse/translator/schema/`:

- `roles.js` — `ROLE` (system/user/assistant/tool), `GEMINI_ROLE` (model/user)
- `blocks.js` — `OPENAI_BLOCK` (text/image_url/tool_use/tool_result), `CLAUDE_BLOCK`, content types
- `finishReasons.js` — stop/length/content_filter/tool_calls
- `defaults.js` — default model, temperature, max_tokens

Reference: `open-sse/translator/schema/`

## Direct Routes

A translator registered on an exact `source:target` pair (e.g. `claude:kiro`) runs as a direct route, skipping the OpenAI double-hop. Prefer direct routes for fragile pairs:
- Thinking blocks
- Tool call IDs
- Non-base64 images
- `is_error` tool results

## Anti-patterns

- Don't hardcode strings from `schema/` — import the constants
- Don't forget to add the import to `index.js` — translators only work when imported
- Don't add platform-specific instructions in translator files (platform logic lives in executors)
## Passthrough system folding (v0.5.55 behavior change)

`normalizeClaudePassthrough` no longer hoists mid-conversation `system` messages
into `body.system`. Since v0.5.55 (`7e5f5a88`, cache-breakpoint re-anchor) they
are **folded into the neighbouring user turn** (copy-on-write, original body
never mutated):

- Previous contract: `body.system` receives extra text blocks; `body.messages`
  loses all `system`-role messages.
- Current contract: `body.system` stays untouched; the system text is appended
  as a text block to the previous user message (or a new user message if none).
- Tests asserting the old hoist behavior must be updated to the fold contract.
