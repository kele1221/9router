# Directory Structure

## App Router

`src/app/api/v1/` — OpenAI-compatible endpoints. Each endpoint maps `/v1/<path>` → `src/app/api/v1/<path>/route.js`.

`src/app/api/` — management routes (auth, settings, providers, oauth, keys, combos, pricing, usage, sync).

Files: `route.js` inside kebab-case directories (e.g., `src/app/api/v1/chat/completions/route.js`).

Reference:
- `src/app/api/v1/` — 9 compat route dirs
- `src/app/api/` — 12+ management route dirs

## SSE Handlers

`src/sse/handlers/` — entry glue between app routes and the open-sse engine. Thin wrappers that parse request, call `open-sse/handlers/chatCore.js`, and stream response.

Pattern:
```javascript
// Parse model/combo from request
// Expand combo → model list if needed
// Select account (multi-account fallback)
// Call chatCore.handler() or chatCore.streamingHandler()
// Write SSE chunks back to Response
```

Reference: `src/sse/handlers/chat.js`

## Shared Code

`src/shared/` — components (React), config, constants, hooks, services, utils. Shared between dashboard UI and API routes.

`src/lib/` — non-DB utilities: auth, fork, headroom, mcp, network, oauth, pxpipe, qoder, tunnel.

Convention: `.js` (not `.jsx`) files. ESM imports with `@/` alias via Next.js path alias.

## Dashboard UI

`src/app/dashboard/` + `src/shared/components/`. Next.js pages with React components. Zustand stores in `src/store/`.

## Anti-patterns

- Don't create new top-level directories in `src/` without a clear package boundary
- Don't import from `src/` into `open-sse/` — that crossing is one-way (src imports open-sse, not reverse)
