# CLI (cli/) — Spec Index

`cli/` is a standalone npm package (`9router`) that launches the server, manages system tray, and provides CLI commands. Built with esbuild, published to npm separately from the dashboard.

## Pre-Development Checklist

- [ ] Entry point: `cli.js`
- [ ] Build: `npm run cli:pack` from repo root, or `cd cli && npm run dev` for dev mode
- [ ] Runtime dependencies lazy-installed to `~/.9router/runtime/` via postinstall hook
- [ ] Engines: `node >= 18.0.0`

## Quality Check

- [ ] `npm run cli:pack` builds without errors
- [ ] CLI commands use `src/cli/commands/` pattern
- [ ] No filesystem writes outside `~/.9router/`