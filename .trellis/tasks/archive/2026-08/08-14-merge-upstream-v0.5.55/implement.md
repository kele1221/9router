# Implement — merge upstream v0.5.55

## Completed steps

1. **Clean base** `c3555bcb`: committed `restart.sh` (background launch + log) and `OverviewCards.js` (千万 units) before merge.
2. **Merge** `c3723d3e`: 3 conflicts resolved:
   - `CHANGELOG.md`: fork Chinese entries on top + upstream v0.5.55 entry.
   - `cli/package.json`: upstream `version 0.5.55` + fork `forkVersion 0.5.55-k.12` + `forkRepository`.
   - `settingsRepo.js`: upstream SAML defaults + fork `enableObservability: true` kept.
3. **Version bump** `881e48a5`: `fork.js` + `fork-cli-updater-safety.test.js` → `0.5.55-k.12`; grep for old refs empty.
4. **Build**: `npm run build` OK (installed new dep `@node-saml/node-saml` first). CLI pack `9router-0.5.55.tgz`, `npm install -g`, `9router --version` = `0.5.55-k.12`.
5. **Regression forensics** (baseline worktree `c3555bcb`): 86 baseline fails vs 88 post-merge; 1 real regression (`translator-helpers-edge.test.js` system hoist → fold contract, upstream `7e5f5a88` changed behavior without updating test; adapted test, 7/7 green); 1 env-only (`golden-url-header` clinepass snapshot platform, sibling fails already baseline-inherent).
6. **Spec + journal**: `translator-conventions.md` fold contract; journal entry. Commit `8050d38a`.
7. **Archive**: this task.
