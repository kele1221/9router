# Merge upstream v0.5.50 — Execution Plan

## Checklist

- [ ] **Step 0 (clean base):** Commit fork-only dirty changes first
  ```bash
  git add restart.sh "src/app/(dashboard)/dashboard/usage/components/fork/RateLimitNormalizationNotice.js"
  git commit -m "chore(fork): restart.sh npx-next-start + SSR-safe notice dismissal"
  ```
  `.trellis/research/proxy-pool-account-pool.md` left untracked — do NOT add.

- [ ] **Step 1: Merge upstream/master into product**
  ```bash
  git merge upstream/master
  ```
  Resolve conflicts per `design.md` table, then `git add` conflicted files + `git commit` (merge commit). Document each resolved conflict.

- [ ] **Step 2: Sync root & cli package.json versions**
  Ensure root `package.json` version matches upstream `0.5.50`; re-apply fork fields (forkVersion, forkRepository) on both.

- [ ] **Step 3: Bump forkVersion k.10 → k.11**
  - `cli/package.json`: `0.5.45-k.10` → `0.5.50-k.11`
  - `src/shared/constants/fork.js`: → `0.5.50-k.11`
  - `tests/unit/fork-cli-updater-safety.test.js`: assertion → `0.5.50-k.11`
  - Grep confirm no other `k.10`/`0.5.45-k` refs remain (src/, tests/, cli/).

- [ ] **Step 4: Build Next.js standalone**
  ```bash
  npm run build
  ```

- [ ] **Step 5: Pack CLI**
  ```bash
  cd cli && npm install && node scripts/buildMitm.js && npm pack --pack-destination ..
  ```
  (build-cli.js already copies standalone+public assets; run `scripts/copy-standalone-assets.mjs` only if pack output is missing public/static.)

- [ ] **Step 6: Install globally**
  ```bash
  npm install -g ./9router-*.tgz
  ```

- [ ] **Step 7: Verify**
  ```bash
  9router --version   # expect 0.5.50-k.11
  ```

## Validation gates

- Step 1: `git log --oneline -1` shows `15223724` reachable (upstream HEAD present). Conflict list recorded.
- Step 3: `grep -rn 'k\.10\|0\.5\.45-k' src/ tests/ cli/ --include='*.js' --include='*.json' | grep -v node_modules` returns nothing.
- Step 4/5: build+pack succeed with no asset-copy errors.
- Step 7: `9router --version` → `0.5.50-k.11`.
- Regression: run `tests/__baseline__/verify-no-regression.mjs`; diff vs `known-fails.txt` — no NEW failures beyond catalogue.

## Post-merge recap steps (Phase 3)

- Update task check records, journal, and archive task as completed (mirror archived v0.5.45).
- Bump root `CHANGELOG.md` fork entry.