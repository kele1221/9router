# Merge upstream v0.5.55 — Technical Design

## Boundaries

**In scope:**
- Commit pre-existing fork dirty changes as a clean merge base.
- Git merge `upstream/master` into `product`, preserving fork features.
- Bump fork version to `0.5.55-k.12`.
- Next.js build + CLI pack + npm global install + regression forensics.

**Out of scope:**
- Upstream code review or optimization.
- Adding/removing fork features.

## Merge strategy

Conflict resolution per archived v0.5.50 design:

| File category | Strategy |
|---|---|
| `open-sse/**`, `cli/**` | Accept upstream. |
| `src/**` | Case by case, preserve fork additions (Chinese UI, observability default). |
| `package.json`, `cli/package.json` | Upstream version, re-apply fork fields (`forkVersion`, `forkRepository`). |
| `CHANGELOG.md` | Upstream + re-merge fork entries at top (mojibake preserved). |
| `restart.sh`, fork-only components | Keep fork (commit first). |

## Version bump map (k.11 → k.12)

| File | Change |
|---|---|
| `cli/package.json` | `forkVersion`: `0.5.50-k.11` → `0.5.55-k.12` |
| `src/shared/constants/fork.js` | `version` → `0.5.55-k.12` |
| `tests/unit/fork-cli-updater-safety.test.js` | assertion → `0.5.55-k.12` |

## Build & deploy

1. Commit clean base. 2. Merge + resolve. 3. Bump forkVersion. 4. `npm run build`.
5. `cd cli && node scripts/buildMitm.js && npm pack`. 6. `npm install -g`. 7. Verify `9router --version` = `0.5.55-k.12`.

## Regression forensics

Baseline worktree at clean merge base commit; run same failing file set; diff `(file, fullName)` failure sets; only merge-only failures need root-cause.
