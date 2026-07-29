# Security

## IP Derivation

`custom-server.js` wraps `http.createServer` to derive client IP from the TCP socket and strip attacker-controlled `X-Forwarded-For` headers. Forwarding headers are trusted only from loopback reverse proxies.

**Rule**: Never add trust for `X-Forwarded-For` or similar forwarding headers without an explicit, controlled source. IP-dependent logic (rate limiting, auth) must use the socket-derived IP.

Reference: `custom-server.js`

## Authentication

Session-based auth via JWT cookies. Env vars:
- `JWT_SECRET` — session cookie signing key
- `INITIAL_PASSWORD` — default `123456` (override in production)
- `API_KEY_SECRET` — API key signing
- `MACHINE_ID_SALT` — machine identity

**Rule**: Never log or expose `JWT_SECRET`, `API_KEY_SECRET`, or `MACHINE_ID_SALT`. Never commit `.env` files.

Reference: `src/lib/auth.js`, `.env.example`

## Credential Handling

OAuth tokens and API keys stored in the SQLite DB. The `credentials` object passed through translator/executor layers contains raw tokens.

**Rule**: Don't log `credentials.accessToken` or `credentials.apiKey`. Token refresh logic in `open-sse/services/tokenRefresh/` handles rotation — don't implement custom refresh unless the provider doesn't fit the existing pattern.

## Input Validation

Route handlers are the trust boundary. Validate incoming request body shape before passing to the engine. The engine (`open-sse/`) assumes valid input.

**Rule**: Validate at route entry (`src/app/api/v1/*/route.js`), not deep in the engine.
