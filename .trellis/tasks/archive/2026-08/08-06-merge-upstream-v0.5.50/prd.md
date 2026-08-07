# Merge upstream v0.5.50 into product branch

## Goal

Merge latest upstream (decolua/9router) code into the fork's `product` branch, rebuild, and deploy as global npm package.

## Background

- Last merge stopped at upstream `6fcd2733` (v0.5.45), committed fork version `0.5.45-k.10`.
- Upstream master since then: `6fcd2733..15223724` = **42 commits / 180 files**, tagged **v0.5.50** (2026-08-05). Includes new providers (TokenRouter, self-hosted STT/TTS/embedding, Xiaomi MiMo), Qwen removal, capacity adapter wiring, OAuth/PAT changes, and many src/ UI changes.
- Reuse the proven workflow from archived task `07-30-merge-upstream-v0.5.45`.

## Requirements

1. Merge `upstream/master` (to `15223724`, v0.5.50) into `product`.
2. Resolve conflicts, preserving fork-specific features (Chinese UI, error rules, fork.js, restart.sh, RateLimitNormalizationNotice).
3. Handle pre-existing uncommitted fork changes first — commit them as a clean merge base.
4. Bump fork version to `0.5.50-k.11` in all reference points.
5. Build Next.js standalone, pack CLI tgz, install globally.

## Acceptance Criteria

- `product` contains all upstream commits up to `15223724` plus all existing fork features.
- Every merge conflict resolved; each resolved file documented (which side kept and why).
- All forkVersion references updated to `0.5.50-k.11` (cli/package.json, src/shared/constants/fork.js, tests/unit/fork-cli-updater-safety.test.js).
- `9router --version` outputs `0.5.50-k.11`.
- `9router` command starts the server with merged code.
- All existing fork functionality (error code redirection, Chinese UI, fork version display) preserved after merge.
- No regression on `tests/__baseline__/verify-no-regression.mjs` beyond the committed `known-fails.txt` catalogue.