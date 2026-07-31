# Merge upstream v0.5.45 — Technical Design

## Boundaries

**In scope:**
- Git merge `upstream/master` into `product` with fork features preserved
- Bump fork version
- Next.js build + CLI pack + npm global install

**Out of scope:**
- Upstream code review or optimization
- Adding/removing fork features
- Testing individual upstream commits

## Merge strategy

Use `git merge upstream/master` on `product` branch. Conflict resolution approach per category:

| File category | Strategy |
|---|---|
| `open-sse/providers/` (provider files) | Accept upstream unless fork-modified. Fork rarely changes these. |
| `src/` (dashboard/API) | Fork features are isolated to specific files — resolve case by case. Fork additions (Chinese UI, error rules) must be preserved. |
| `cli/` | Accept upstream, fork has minimal changes here. |
| `package.json`, `cli/package.json` | Accept upstream version, re-apply fork-specific fields (forkVersion, forkRepository). |
| `.env.example`, `CHANGELOG.md` | Accept upstream, merge fork entries manually. |

## Rollback

If merge produces unresolvable conflicts, abort with `git merge --abort`. Document the conflict files and assess root cause.

## Build & deploy

After successful merge:
1. Bump `forkVersion` in `cli/package.json` → `0.5.45-k.10`
2. Bump `forkVersion` in fork config (grep for old version string)
3. `npm run build` (Next.js standalone)
4. `cd cli && npm install && node scripts/buildMitm.js && npm pack --pack-destination ..`
5. `npm install -g ../9router-*.tgz`
