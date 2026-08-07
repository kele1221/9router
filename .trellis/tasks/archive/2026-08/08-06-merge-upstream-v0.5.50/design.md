# Merge upstream v0.5.50 — Technical Design

## Boundaries

**In scope:**
- Commit pre-existing fork dirty changes as a clean merge base.
- Git merge `upstream/master` into `product`, preserving fork features.
- Bump fork version to `0.5.50-k.11`.
- Next.js build + CLI pack + npm global install.

**Out of scope:**
- Upstream code review or optimization.
- Adding/removing fork features.
- Testing individual upstream commits.

## Merge strategy

`git merge upstream/master` on `product`. Conflict resolution per category (reuse archived v0.5.45 design):

| File category | Strategy |
|---|---|
| `open-sse/providers/**`, `open-sse/executors/*`, `open-sse/translator/**` | Accept upstream. Fork rarely modifies these. Watch upstream deletion of `qwen.*` — our fork has no custom qwen code, so accept delete. |
| `src/**` (dashboard/API/UI) | Fork additions (Chinese UI, error code redirection, RateLimitNormalizationNotice) are isolated to specific files — resolve case by case, preserve fork additions. |
| `custom-server.js` | Upstream modified it; fork interacts with it via restart.sh and IP-derivation. Take upstream, re-verify restart.sh still works. |
| `cli/**` | Take upstream; fork has minimal changes here. |
| `package.json`, `cli/package.json` | Take upstream version, re-apply fork-specific fields (forkVersion, forkRepository). |
| `restart.sh`, `src/app/(dashboard)/dashboard/usage/components/fork/RateLimitNormalizationNotice.js` | Fork-only files, untouched upstream this release — keep as-is (commit them first). |
| `.env.example`, `CHANGELOG.md` | Accept upstream; re-merge fork entries manually. |

## Pre-existing uncommitted changes (merge base step)

Two fork-only files are dirty and untouched by upstream:
- `restart.sh` (start cmd → `npx next start`)
- `src/app/(dashboard)/dashboard/usage/components/fork/RateLimitNormalizationNotice.js` (lazy localStorage init for SSR safety)

Commit these before merging so the merge tree stays clean. `.trellis/research/proxy-pool-account-pool.md` is a research note — leave untracked, do not commit with the merge.

## Version bump map (k.10 → k.11)

| File | Change |
|---|---|
| `cli/package.json` | `forkVersion`: `0.5.45-k.10` → `0.5.50-k.11` |
| `src/shared/constants/fork.js` | `version` field → `0.5.50-k.11` |
| `tests/unit/fork-cli-updater-safety.test.js` | assertion → `0.5.50-k.11` |

## Build & deploy (from archived v0.5.45 plan)

1. Commit clean base.
2. `git merge upstream/master`, resolve per table above.
3. Bump forkVersion (k.11) per map; sync `cli/package.json` version to upstream `0.5.50`.
4. `npm run build` (Next.js standalone).
5. `cd cli && npm install && node scripts/buildMitm.js && npm pack --pack-destination ..` (+ run new `scripts/copy-standalone-assets.mjs` if upstream added it to the pack path).
6. `npm install -g ../9router-*.tgz`.
7. Verify `9router --version`.

## Rollback

If merge produces unresolvable conflicts: `git merge --abort`, document conflict files, reassess. Clean merge base commit can be `git reset --soft HEAD~1` if needed (no push yet).