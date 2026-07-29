# API Route Conventions

## Route Handler Pattern

Next.js App Router route handlers. Each route exports an async function:

```javascript
export async function POST(request) { ... }
export async function GET(request) { ... }
```

## Request Flow

```
Client POST /v1/chat/completions
  → next.config.mjs rewrite /v1/:path* → /api/v1/:path*
  → src/app/api/v1/chat/completions/route.js  (parse + validate)
  → src/sse/handlers/chat.js                    (combo expand, account select)
  → open-sse/handlers/chatCore.js               (format detect, translate, execute)
  → open-sse/executors/<provider>.js            (upstream call)
  → SSE chunks back to client
```

## Adding an Endpoint

1. Create `src/app/api/v1/<endpoint>/route.js`
2. Create matching handler in `src/sse/handlers/<handler>.js`
3. The handler calls into `open-sse/handlers/<core>.js` for provider-agnostic logic
4. If the endpoint is new, add a rewrite rule in `next.config.mjs` (pattern: `/v1/:path*`)

Reference: `src/sse/handlers/` (chat.js, embeddings.js, fetch.js, imageGeneration.js, search.js, stt, tts, videoGeneration)

## Response Format

All `/v1/*` endpoints return OpenAI-compatible format. Streaming uses SSE (`text/event-stream`). Non-streaming returns `application/json`.

## Error Responses

```javascript
return Response.json({ error: { message, type, code } }, { status })
```

Common status codes: 400 (bad request), 401 (auth), 403 (forbidden), 429 (rate limit), 500 (internal).

Reference: `open-sse/utils/errorHandler.js`
