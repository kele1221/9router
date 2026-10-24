# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

9Router (`9router-app`) — a local AI routing gateway + Next.js dashboard. It exposes one OpenAI-compatible endpoint (`/v1/*`) and routes traffic across 40+ upstream providers with format translation, model-combo fallback, multi-account fallback, OAuth/API-key credential management, token refresh, quota/usage tracking, and optional cloud sync.

Two published artifacts live in this one repo:
- The **dashboard + gateway** (root `package.json`, `9router-app`) — the Next.js server that does the actual routing.
- The **CLI launcher** (`cli/`, published to npm as `9router`) — a separate package that installs/starts the server and manages the tray. It has its own `package.json`, version, and build.

The code lives in `src/` (Next.js app + dashboard/compat APIs), `open-sse/` (the provider-agnostic routing/translation engine), `cli/` (the launcher package), and `tests/`.

## Commands

Dashboard/gateway (run from repo root):
```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev   # dev (webpack, port 20127 by default via next dev)
npm run build && PORT=20128 HOSTNAME=0.0.0.0 npm run start           # production
```
- Bun variants: `npm run dev:bun` / `build:bun` / `start:bun`.
- Prod port is **20128** (dashboard at `/dashboard`, API at `/v1`) — but only via `boot.sh` / `cli/`, which pass `--port 20128`. The bare `npm run start` script hardcodes `--port 20127`, and an explicit `--port` beats the `PORT` env var, so setting `PORT=20128` alone does **not** move a plain `npm run start` off 20127.
- Lint: `npx eslint .` (config `eslint.config.mjs`, extends `eslint-config-next`).
- **This checkout is the user's live router** (port 20128, currently serving agent traffic). After changing code, run `npm run build` and let the user restart — never run `./restart.sh` or kill the process yourself without explicit confirmation.

CLI package (`cli/`):
```bash
npm run cli:pack       # build + npm pack from root
cd cli && npm run dev  # nodemon watch
```

Tests (vitest, in `tests/`, an **independent** ESM package — not wired into root `npm test`):
```bash
npm install                             # ROOT deps first — tests import from src/ which needs `open`, `undici`, etc.
cd tests && npm install                 # then tests' own deps (vitest) → tests/node_modules (allowed by tests/.gitignore)
npx vitest run                          # all tests; auto-discovers tests/vitest.config.js
npx vitest run unit/capabilities.test.js   # single file (path relative to tests/)
```
> Run tests from inside `tests/`; `vitest.config.js` resolves the `open-sse`/`@/` aliases from the repo root regardless of where vitest lives.
>
> Test runs never touch the live DB: the default vitest project points `DATA_DIR` at a throwaway temp dir (`tests/setup/isolatedDataDir.js`, runs before each test file). Pass `DATA_DIR` explicitly to override. `*.real.test.js` are a separate vitest project on purpose — they read the real DB for credentials and are gated by `RUN_REAL=1`.
>
> **Two different gates exist — don't confuse them:**
> - **CI** (`.github/workflows/fork-ci.yml`, on PRs/pushes to `product`) runs `npm run test:fork --prefix tests` — a narrow fork/routing subset (`tests/vitest.fork.config.js`: `chat-fallback-preserves-error`, `fork-*`, `routing-*`, `upstream-error-*`) plus `npm run build`. It does **not** run the full suite. This is the merge gate.
> - **Full suite** is NOT expected to be all-green on a plain checkout. Use `tests/__baseline__/verify-no-regression.mjs`, **never** a raw pass/fail count:
> ```bash
> cd tests && npx vitest run --reporter=json --outputFile=../tests/__baseline__/current.json
> cd ..    && node tests/__baseline__/verify-no-regression.mjs tests/__baseline__/current.json
> ```
> Expected red on a plain checkout:
> - The tests catalogued in `tests/__baseline__/known-fails.txt` (currently 17).
> - `unit/embeddings.cloud.test.js` imports `cloud/src/handlers/embeddings.js` — the `cloud/` worker dir is **not in this repo**, so it always fails here.
> - `unit/xai-oauth-service.test.js` times out (5s) when the xAI endpoint-discovery fetch isn't reachable/mocked.
> - `real/*.real.test.js` make live provider calls — need credentials, skip otherwise.
- Regression baselines: `tests/__baseline__/verify-*.mjs` compare against committed snapshots (providers, aliases, OAuth URLs). Run these after touching provider registry / alias logic.

## Architecture

Two authoritative docs already exist — read them before working in these areas rather than re-deriving:
- `docs/ARCHITECTURE.md` — full system: request lifecycle, combo/account fallback, OAuth + token refresh, cloud sync, data model.
- `open-sse/AGENTS.md` — the routing/translation engine's own conventions and "how to add a provider/executor/translator". **Read this before editing anything under `open-sse/`.**

### Request flow (the thing to understand first)
`src/app/api/v1/*` route (Next rewrite maps `/v1/*` → `/api/v1/*` in `next.config.mjs`)
→ `src/sse/handlers/chat.js` (parse, combo expansion, account-selection loop)
→ `open-sse/handlers/chatCore.js` (detect source format, translate request, dispatch to executor, retry/refresh, stream setup)
→ `open-sse/executors/*` (per-provider upstream call; `default.js` handles any OpenAI-compatible provider)
→ `open-sse/translator/*` (client format ↔ provider format)
→ SSE back to client.

`src/sse/` is the app-side entry glue; `open-sse/` is the provider-agnostic engine (also usable standalone). Cross that boundary consciously.

### Translator engine (`open-sse/translator/`)
- Pivots through **OpenAI as the intermediate format**. A translator registered on an exact `source:target` pair (e.g. `claude:kiro`) runs as a **direct route**, skipping the lossy double-hop. Prefer a direct route for fragile pairs (thinking blocks, tool ids, non-base64 images, `is_error`).
- Translators **self-register** via `register(from, to, reqFn, resFn)` as an import side effect — a new translator file MUST be imported in `open-sse/translator/index.js` or it never runs.
- Never hardcode role/block/model strings — use `open-sse/translator/schema/` and `open-sse/config/` constants. Config-driven and DRY is enforced by convention here.

### Provider registry (`open-sse/providers/registry/*`)
- One file per provider. `providers/registry/index.js` is an **auto-generated** static import list — regenerate it with `scripts/migrate-registry.mjs` / `injectDisplayToRegistry.mjs`, don't hand-edit.
- Add a provider: copy `providers/REGISTRY_TEMPLATE.js`, add models to `config/providerModels.js`. Only add an executor for non-OpenAI-compatible upstreams.

### Persistence — IMPORTANT (ARCHITECTURE.md is stale here)
State is **no longer `db.json`**. It's a SQLite layer under `src/lib/db/` with an adapter fallback chain (`driver.js`): `bun:sqlite` → `better-sqlite3` (optional native dep) → `node:sqlite` (Node ≥22.5) → `sql.js` (pure-JS fallback, always works). `better-sqlite3` is deliberately in `optionalDependencies` so install never fails without build tools.
- `src/lib/localDb.js` and `src/lib/usageDb.js` are **backward-compat shims** re-exporting `src/lib/db/index.js`. New code should import from `@/lib/db/index.js`; per-entity logic lives in `src/lib/db/repos/*` (`usageRepo`, `requestDetailsRepo`, `nodesRepo`, …). Schema/migrations in `src/lib/db/migrations/`.
- DB file location resolves via `src/lib/db/paths.js` → `src/lib/dataDir.js` (`DATA_DIR`, else `~/.9router/`, else `%APPDATA%\9router` on Windows). `paths.js` still lists `LEGACY_FILES` (`db.json`, `usage.json`, …) — those are migrated-away names, not live files.
- Both usage history and request details now live in SQLite (`usageRepo`, `requestDetailsRepo`) and **do** follow `DATA_DIR`. The only paths still outside it: request/translator logs under the repo's `logs/` (`requestLogger.js` uses `process.cwd()`), and MITM dumps at `$DATA_DIR/logs/mitm`.

### RTK token saver (`open-sse/rtk/`)
Pre-translate hooks that compress `tool_result` content in-place to cut tokens. **Fail-open**: any error returns null and leaves the body untouched — never throw out of them. Skips `is_error`/`status:"error"` results to preserve traces.

## Conventions & gotchas

- Plain JavaScript (ESM), no TypeScript. `@/*` path alias → `src/*` (`jsconfig.json`).
- `custom-server.js` wraps the Next standalone server to derive client IP from the TCP socket and strip attacker-controlled `X-Forwarded-For` — trusting forwarding headers only from a loopback reverse proxy. Preserve this when touching request/IP/rate-limit code.
- Security-sensitive env: `JWT_SECRET` (session cookie), `INITIAL_PASSWORD` (default `123456` — must override), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Full env contract in `.env.example` and ARCHITECTURE.md's env matrix.
- Binary/protobuf upstreams (kiro EventStream, cursor protobuf, commandcode NDJSON) don't round-trip through OpenAI — they're handled inside their own executor, not the translator.
- **Security-first on PRs**: Security is the top priority when reviewing or creating PRs. Audit authentication, credential/token storage & leaks, header manipulation (`X-Forwarded-For`), and SSRF risks before functional logic. Always include explicit security warnings/notes when reporting PR reviews or changes to the user.
- Versioning: root and `cli/` are versioned independently; changes are logged in `CHANGELOG.md`. Commit style is Conventional Commits (`fix(translator): …`, `feat(...)`).

## Fork operation (this is a fork, not upstream)

- **Fork version lives in `cli/package.json` `forkVersion`** (currently `"0.5.99-k.2"`), not `version` — `version` and root `package.json` keep tracking upstream. `cli/cli.js` displays `forkVersion || version` and sets `IS_FORK` from its presence.
- Release: tag `fork-v<forkVersion>` → `.github/workflows/fork-release.yml` asserts the tag equals `fork-v$(forkVersion)` before building, so bumping `forkVersion` is a precondition. `tests/unit/fork-cli-updater-safety.test.js` pins the value — bump it in both places.
- Branches: `product` is the integration branch (CI and PRs target it); upstream sync (`.github/workflows/upstream-sync.yml`, every 6h) mirrors `decolua/9router:master` and opens a `sync/upstream` **candidate PR against `product` — never auto-merged**. Day-to-day work happens on `release/*`.
- `docs/routing/` is fork-operational and authoritative for production routing behavior, beyond `ARCHITECTURE.md`:
  - `CHAIN.md` — the real routing chain (Claude Code → Model-Switch:15721 → this router:20128 → provider node). The live chain declaration is **outside the repo** at `DATA_DIR/fork/routing-chains.local.json`; `src/shared/config/routing-chains.json` is a redacted template.
  - `RUNBOOK.md` — 400→429 normalization. `BACKUP_AND_ROLLBACK.md` — backup dirs contain API keys (use 700/600, never commit). `UPSTREAM_SYNC.md`.
- `docs/research/`, `docs/superpowers/`, `docs/PROXY_ROTATION_PLAN.md` are scratch/planning — not authoritative.
- `.trellis/` is a live workflow system with per-package spec indexes (`spec/{engine,dashboard,cli,guides}/index.md`) holding pre-dev and quality-check checklists. `.claude/hooks/` injects session/task state automatically (`UserPromptSubmit`, `SessionStart`, and Trellis context into subagents on `Task`/`Agent`) — don't duplicate that context by hand.
