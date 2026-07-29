# Executor Conventions

## When to Add an Executor

Executors handle the upstream API call. The `default.js` executor works for any OpenAI-compatible provider.

**Add a new executor only when** the provider:
- Uses a binary/protobuf protocol (e.g., Kiro EventStream, Cursor protobuf)
- Uses NDJSON (e.g., CommandCode)
- Requires custom auth or signing logic
- Has non-standard streaming chunks

Reference: `open-sse/executors/default.js` — the baseline that covers most providers

## Executor Interface

Each executor exports:
```javascript
export async function execute(request, provider, model, credentials, options) { ... }
```

Returns an async iterable of SSE chunks or a JSON response.

## Existing Executors

`open-sse/executors/` — 25 files covering specialized providers (antigravity, bard, claude, commandcode, cursor, gemini, grok, kiro, ollama, openrouter, vertex, etc.).

## Anti-patterns

- Don't add a new executor for OpenAI-compatible providers — extend `default.js` if needed
- Don't duplicate auth/refresh logic — use `open-sse/services/tokenRefresh/`