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

## Custom executors MUST map cache/usage fields by hand

A specialized executor that bypasses the generic OpenAI response path also bypasses
`extractUsage()`, which is what normally reads `prompt_tokens_details.cached_tokens` /
`prompt_cache_hit_tokens` for free. Any cache accounting must then be done explicitly
in that provider's extractor in `open-sse/translator/concerns/usage.js`.

**Failure mode seen in production:** `USAGE_EXTRACTORS.commandcode` read only
`inputTokens/outputTokens/totalTokens`, so `cached_tokens` was stored as `0` for all
3,489 historical requests. Because `calculateCostFromTokens()` subtracts `cached_tokens`
to apply the cache rate, every cache-hit token was billed at the **full input rate**
(measured 14.5x overcharge on a 75k-prompt/72k-cached request). The bug is silent —
requests succeed, only the numbers are wrong.

When adding a provider whose upstream reports cache usage, always ask: *does this
protocol reuse the generic OpenAI parser, or do I own the field mapping?*

**Two-shape defense:** CommandCode's upstream is AI SDK based and its usage naming has
already changed across versions (v5 flat `cachedInputTokens` -> v6 nested
`inputTokenDetails.cacheReadTokens`). Read **both** shapes so an upstream upgrade cannot
silently zero the cache counts again.

**Subset vs additive — get this right per provider:**
- Cache-inclusive prompt (OpenAI / Gemini / AI SDK / CommandCode, where
  `inputTokens.total` already contains the cached part): report cache as a **subset**,
  never add it to `promptTokens`.
- Cache-exclusive prompt (Claude: `input_tokens` excludes cache): **add** cache read +
  creation to `promptTokens` (see the `claude()` extractor).
Getting this backwards double-counts the prefix and *overstates* cost — worse than not
fixing it.

**Do not report `reasoningTokens` unless you have verified it is not already inside
`completionTokens`.** `calculateCostFromTokens()` adds `reasoning_tokens` **on top of**
`completion_tokens`, while AI SDK's `outputTokens.total` already includes reasoning.
Reporting both double-charges (measured +8.9%).

## Session affinity keys must be stable UUIDs

Providers that keep a server-side prefix cache pinned to a backend node accept a session
affinity key (CommandCode: `threadId` in the body, also the `x-session-id` header). A
fresh `randomUUID()` per request makes every turn a cold, full-prefill request and
discards the cache a direct connection would keep.

- Use the session id 9router **already resolves** — `credentials._clientSessionId`
  (set before request translation in `translator/index.js`) or the `providerSessionId`
  passed to `execute()`. Never invent a new random value when a stable one exists.
- Normalize it with `toUuidSessionId()` (`open-sse/utils/sessionManager.js`): upstream
  **silently drops non-UUID** affinity keys, and internal ids are not always bare UUIDs
  (`claude:<uuid>`, `deriveSessionId()`'s `<uuid><timestamp>`).
- Keep the body field and the header **byte-identical** — `buildHeaders` receives the
  transformed body, so read the value back from it instead of recomputing.
- Only fall back to `randomUUID()` when no session could be resolved at all.

## Anti-patterns

- Don't add a new executor for OpenAI-compatible providers — extend `default.js` if needed
- Don't duplicate auth/refresh logic — use `open-sse/services/tokenRefresh/`
- Don't leave a bespoke protocol's usage/cache fields unmapped — see the cache section above
- Don't generate a per-request random value for any field that upstream uses for
  session affinity or cache routing
### Known limitations of the scoped affinity key

- **Header-less clients.** When no client session header/body field exists,
  `resolveSessionIdentity()` falls back to `assistantTextSessionId(scope:connectionId, body)`
  (a per-connection key derived from assistant text) or `deriveSessionId(connectionId)`
  (per-connection). Turn 1 of a fresh conversation therefore differs from turn 2+, and two
  conversations on one connection share a key. The scoping fix turns "random every request"
  into "stable, connection-scoped"; it does not make the key per-conversation. Clients that
  send a session header (`x-claude-code-session-id`, `x-session-id`, `prompt_cache_key`, …)
  get true per-conversation affinity.
- **Missing `connectionId`.** `deriveSessionId(undefined)` yields a fresh value per call, so
  affinity is silently lost while still looking stable. In the normal chat path
  (`chatCore` → `credentials.connectionId`) it is always present.
- **User header overrides win.** `providerOverrides.headers` is applied after
  `buildHeaders()` in `base.js`, so an explicit `x-session-id` override intentionally
  overrides the body-derived value and the two can disagree for that request.

Changing the derivation itself is deliberately out of scope here — `sessionManager` is
shared by 40+ providers and any change has a much wider blast radius than this provider.
