# Cross-Package Thinking Guide

## Data Flow: Request Lifecycle

```
Client POST /v1/chat/completions
  → next.config.mjs rewrite            (src/ — rewrite /v1/* → /api/v1/*)
  → src/app/api/v1/chat/completions/   (src/ — route handler, validate input)
  → src/sse/handlers/chat.js           (src/ — combo expand, account select)
  → open-sse/handlers/chatCore.js      (open-sse — format detect, translate, execute)
    → open-sse/rtk/index.js            (open-sse — compressMessages, fail-open)
    → open-sse/executors/getExecutor() (open-sse — resolve provider executor)
    → open-sse/translator/             (open-sse — translateRequest → executor → translateResponse)
  → SSE stream back to client
```

## File Convention

**All files**: `kebab-case.js`. No `.ts`, `.tsx`, `.jsx`.  
**Route files**: `route.js` inside kebab-case path directories.  
**Tests**: `*.test.js` (unit), `*.real.test.js` (real API), `*.e2e.test.js` (end-to-end).

## Import Style

- ESM (`import`/`export`) everywhere. No CommonJS except `custom-server.js`.
- `@/` → `src/` (configured in `jsconfig.json`)
- Deep imports within packages. Barrel exports for public API surfaces.
- `open-sse/` is imported by `src/` via relative path — it has no `@/` alias.

## Error Handling

- Fail-open pattern for optional features (RTK, token compression)
- `console.warn` with `[Module]` tag prefix: `console.warn("[RTK]", e.message)`
- Custom error classes for migration: `MigrationAborted` with `droppedRows` payload

## Testing

- Vitest in `tests/` (independent ESM package)
- Regression baseline system in `tests/__baseline__/`
- Run: `npx vitest run` from repo root after `npm install` + `cd tests && npm install`
- Known fails documented in `tests/__baseline__/known-fails.txt`
- **Judging merge regressions vs. pre-existing environment failures**: after an upstream merge, `verify-no-regression.mjs` flags failures not in `known-fails.txt` as regressions — but many are fork-inherent env failures (live provider calls, concurrency, source-assertion audits, proto deps). To tell them apart, run the *same failing files* against the pre-merge fork state: `git worktree add /tmp/baseline <pre-merge-commit>` (symlink `node_modules` + `tests/node_modules` from main), run the failing files, and diff the `(file, fullName)` failure sets. Cases failing on both = inherent (not regressions, no catalogue update needed); cases failing only post-merge = real regressions to fix or catalogue.

## API Format Pivot

OpenAI is the intermediate format for all translation. Request / response translation:
- `source → openai → target` (double-hop, standard path)
- `source → target` (direct route for fragile pairs)

## Common Mistakes

### 1. Validation at Wrong Layer
**Bad**: Validating request body deep in open-sse engine.  
**Good**: Validate at route entry (`src/app/api/v1/*/route.js`) — the engine assumes valid input.

### 2. Forgetting Translator Import
Translator files self-register at import time. A new translator file must be imported in `open-sse/translator/index.js` or it never runs.

### 3. Skipping REGISTRY_TEMPLATE
New providers must copy `open-sse/providers/REGISTRY_TEMPLATE.js` as a base. The registry index is auto-generated — never hand-edit it.
