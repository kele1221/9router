# Engine (open-sse/) — Spec Index

`open-sse/` is the provider-agnostic SSE routing and translation engine. No Next.js dependency — usable standalone.

## Pre-Development Checklist

Before writing code in `open-sse/`:
- [ ] Read `open-sse/AGENTS.md` — the authoritative conventions doc for this package
- [ ] Identify if you need a new translator, executor, or provider — each has a different workflow
- [ ] Check if the provider already has a registry entry in `open-sse/providers/registry/`
- [ ] Run `python3 .trellis/scripts/task.py validate <task>` if task context is configured

## Quality Check

- [ ] New providers: added to `open-sse/providers/registry/` as a file, then `index.js` regenerated
- [ ] New translators: file calls `register()` at import time AND is imported in `open-sse/translator/index.js`
- [ ] New executors: only for non-OpenAI-compatible upstreams (OpenAI-compatible uses `default.js`)
- [ ] RTK code: fail-open pattern — never throw out of compressor functions
- [ ] `npx eslint .` passes

## Guidelines
- [Translator Conventions](translator-conventions.md)
- [Executor Conventions](executor-conventions.md)
- [Provider Registry](provider-registry.md)
- [RTK (Request Token Killer)](rtk.md)