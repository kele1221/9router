# ClinePass Upstream Pin and Observation

## Scenario: Fixed ClinePass DeepSeek channel

### 1. Scope / Trigger

Use this contract when adding or changing ClinePass model routing, request-detail
provider attribution, or the Usage → Details upstream display.

### 2. Signatures

Registry model metadata:

```js
upstreamPin: {
  mode: "strict" | "preferred",
  upstreams: string[], // 1..8 unique channel names
}
```

Helpers:

```js
getModelUpstreamPin(aliasOrId, modelId) -> pin | null
applyClinePassRouting({ provider, body, pin }) -> body
extractClinePassRouting(json) -> string | null
buildClinePassUpstreamObservation(expected, actual) -> observation | null
observeClinePassRouting(observation, json) -> observation
```

Request detail field:

```js
upstream: {
  expected: string,
  actual: string | null,
  observed: boolean,
  match: "adopted" | "not-adopted" | "unverified",
}
```

### 3. Contracts

- Apply pin only when the canonical provider is `clinepass`.
- Apply after translation and all body transforms, immediately before executor.
- Strict writes both spellings:
  - `provider.only`
  - `providerOptions.gateway.only`
- Preferred writes both `.order` arrays.
- Preserve unrelated routing subfields and never mutate the input body.
- Provider evidence precedence:
  1. `choices[0].message.provider_metadata.gateway.routing.finalProvider`
  2. `choices[0].delta.provider_metadata.gateway.routing.finalProvider`
  3. top-level `provider_metadata.gateway.routing.finalProvider`
  4. top-level `provider`
- Actual provider is evidence from the response. Never copy `expected` into `actual`.
- Request details are explicit-allowlisted; new fields must be added in
  `requestDetailsRepo.flushToDatabase()`.

### 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| Non-ClinePass provider | return original body, no pin |
| Missing/invalid pin | return original body, no partial allow-list |
| Invalid channel name | invalid pin, no pin |
| More than 8 channels | invalid pin, no pin |
| Cline returns no routing metadata | `unverified` |
| Cline returns a different provider | `not-adopted` |
| Request-scoped 4xx from bad pin | fail request, preserve account fallback semantics |

### 5. Good / Base / Bad Cases

- Good: Codex Responses → OpenAI translation → strict pin attached once at the
  final pre-executor boundary.
- Base: another ClinePass model has no `upstreamPin`; request is unchanged.
- Bad: inject at the raw client handler before translation; Claude/Responses
  translators create a new OpenAI body and may drop the fields.
- Bad: copy client-supplied `providerOptions` through every translator; that
  lets a caller choose upstream routing.

### 6. Tests Required

- Registry pin resolves for the two DeepSeek models and not for others.
- Strict/preferred produce the correct field in both pipeline spellings.
- Original body and nested routing objects are unchanged.
- Claude, Responses, and OpenAI Chat translate first and then receive the pin.
- `deepseek`, `cmc`, and other providers never receive pin fields.
- Direct, planner, delta, and missing metadata become the correct observation.
- Request detail persistence includes the bounded `upstream` field.
- Usage UI shows `DeepSeek`, another channel, or `Unverified`; absence stays neutral.

### 7. Wrong vs Correct

#### Wrong

```js
body.provider = { only: ["deepseek"] };
return handleChatCore({ body });
```

Claude/Responses translation can discard the field, and mutating the shared body
can contaminate another combo attempt.

#### Correct

```js
translatedBody = applyClinePassRouting({
  provider,
  body: translatedBody,
  pin: getModelUpstreamPin(alias, model),
});
```

The server-owned pin is applied to a new body after translation and before dispatch.

