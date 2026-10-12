# Error → Fallback Semantics

How a failed upstream call maps onto (a) cooling an account down and (b) advancing a combo.
`open-sse/services/accountFallback.js` is the single decision point; `open-sse/config/errorConfig.js`
owns the rules and markers.

## One function, two different questions

`checkFallbackError()` answers **"should this ACCOUNT be cooled down?"**. Its name and its
`shouldFallback` field invite a wrong second use: reading it as **"should this COMBO try its
next model?"**. Those questions have the same answer for most errors, which is exactly why the
conflation stays hidden until it bites.

They diverge on **model-level** errors — the upstream does not recognise the model id:

| | account cooldown | combo advance |
|---|---|---|
| model-level 400/404/422 | **no** (credential is fine) | **yes** (that is the point of a combo) |
| request-scoped 400 (context overflow) | no | **no** (a sibling model fails the same way) |
| 401/402/403/429 | yes | yes |
| 5xx | yes (transient) | yes |

So there are two public functions. Use the right one:

```js
checkFallbackError(status, text, backoffLevel, provider)  // account cooldown
shouldTryNextModel(status, text, backoffLevel, provider)  // combo advance
```

**Production failure this prevents:** a combo whose member pointed at a renamed upstream model
id (`ds/deepseek-v4.1-flash`, upstream GA id now `deepseek-flash`) got HTTP 400, `combo.js` read
`shouldFallback === false` as "stop", and the three healthy members after it were never tried —
the whole turn failed. Additionally the blanket `{status: 404}` rule cooled the account down over
a stale registry entry, which cannot help (every account returns the same answer) and made every
later request in the window fail with a copy of that error.

## Rule evaluation order matters

`checkFallbackError` runs three passes:

1. **Text rules** (`ERROR_RULES` entries with `text`) — describe the *nature* of the failure.
2. **Model-level check** — status ∈ {400, 404, 422} and the body matches a model marker.
3. **Status rules** (`ERROR_RULES` entries with `status`).

The model-level check MUST sit between 1 and 3. Moving it after the status pass lets the blanket
`{status: 404}` rule claim `"model not found"` and re-introduce the account lock. Moving it before
the text pass lets it shadow codex's `"model is not supported when using codex with a chatgpt
account"` — an **account-scoped** rule with a 30-minute cooldown that must survive.

That codex wording is deliberately NOT in `MODEL_LEVEL_ERROR_MARKERS` (which has
`unsupported model`, a different string). There is a test pinning this.

## Repository conventions when touching this area

- **Do not widen `checkFallbackError`'s return values** to fix a combo problem — `src/sse/services/auth.js`
  consumes it for account locking, and `20a43f5a` specifically removed cooldowns for request-scoped
  4xx after real single-account failures. Add a decision function instead.
- Markers are **runtime-overridable** via `setRuntimeErrorConfig()` (`src/lib/fork/errorRulesConfig.js`
  loads `~/.9router/fork/error-rules.local.json`). Add new markers to the same mechanism
  (`modelLevelErrorMarkers` sits beside `rateLimitMarkers`) rather than hardcoding strings in the
  decision path. Consumers must read them through the getters, not the frozen arrays.
- `combo.js` still needs `cooldownMs` from `checkFallbackError` for the 502/503/504 transient wait,
  so it calls **both** functions — keep that call when editing.

## Related tests

- `tests/unit/model-level-error-no-cooldown.test.js` — the decision matrix + codex priority
- `tests/unit/combo-model-level-fallback.test.js` — a combo advances past a model-level error but
  fails fast on a request-scoped one
- `tests/unit/account-fallback-4xx.test.js` — the `20a43f5a` guardrail
