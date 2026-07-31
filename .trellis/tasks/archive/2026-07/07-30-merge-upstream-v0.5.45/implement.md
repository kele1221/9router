# Merge upstream v0.5.45 — Execution Plan

## Checklist

- [ ] Step 1: Merge upstream/master into product
  ```bash
  git checkout product
  git merge upstream/master
  ```
  If conflicts: resolve per design.md strategy, then `git add` + `git commit`.

- [ ] Step 2: Sync app/cli package.json versions
  Ensure root `package.json` version matches upstream's `0.5.45`.

- [ ] Step 3: Bump forkVersion to k.10
  Update `cli/package.json` forkVersion → `0.5.45-k.10`.
  Grep for old forkVersion (`k.9`) in `src/` and `tests/` to update any hardcoded references.

- [ ] Step 4: Build Next.js standalone
  ```bash
  npm run build
  ```

- [ ] Step 5: Pack CLI
  ```bash
  cd cli
  npm install
  node scripts/buildMitm.js
  npm pack --pack-destination ..
  ```

- [ ] Step 6: Install globally
  ```bash
  npm install -g ./9router-*.tgz
  ```

- [ ] Step 7: Verify
  ```bash
  9router --version
  ```

## Validation gates

- After Step 1: `git log --oneline` shows upstream commits present
- After Step 3: `grep -r 'k\.9' --include='*.js' --include='*.json' src/ tests/ cli/ | grep -v node_modules` returns no results for version strings
- After Step 6: `9router --version` outputs `0.5.45-k.10`
