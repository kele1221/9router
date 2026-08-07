# Merge upstream v0.5.45 into product branch

## Goal

Merge latest upstream (decolua/9router) code into the fork's product branch, rebuild, and deploy as global npm package.

## Requirements

1. Merge `upstream/master` (v0.5.45, ~30 commits since last merge) into `product` branch
2. Resolve any merge conflicts, preserving fork-specific features
3. Bump fork version to k.10
4. Build Next.js standalone, pack CLI tgz, install globally via npm

## Acceptance Criteria

- `product` branch contains all upstream commits up to `6fcd2733` plus all existing fork features
- `9router --version` outputs `0.5.45-k.10`
- `9router` command starts the server with merged code
- All existing fork functionality (error rules, k.9 features, Chinese UI) preserved after merge