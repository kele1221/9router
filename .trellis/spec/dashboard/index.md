# Dashboard (src/) — Spec Index

`src/` is the Next.js app router server: API routes, SSE handlers, dashboard UI, persistence layer, and shared libraries.

## Pre-Development Checklist

Before writing code in `src/`:
- [ ] Run `grep -R "import .* from.*@/" src/<your-area> | head -20` to find existing patterns
- [ ] Check `src/sse/handlers/` if adding a new API endpoint (see Data Flow below)
- [ ] Check `src/lib/db/repos/` if touching persistence — repos may already expose what you need
- [ ] Check `.env.example` for new env vars

## Quality Check

- [ ] `npx eslint .` passes for changed files
- [ ] No `console.log` left without a `[ModName]` tag
- [ ] DB calls use repo modules, not raw SQL
- [ ] New API routes handle 401/403/429 status codes
- [ ] Security: `custom-server.js` IP derivation preserved (no new `X-Forwarded-For` trust)

## Guidelines
- [Directory Structure](directory-structure.md)
- [API Route Conventions](api-routes.md)
- [Persistence](persistence.md)
- [Security](security.md)
- [Net Monitor Module](net-monitor.md) — 网络监控的指标语义、探测降级、归因优先级、恢复操作边界与相关坑

## Hard Constraints

- **No network-breaking operations**: this machine runs the user's live agent traffic. Never implement, expose, or trigger closing Wi-Fi, taking an interface down, stopping/switching the user's proxy, or rewriting system DNS/routes. Not even as a "recovery" action. See [net-monitor.md](net-monitor.md) for the allowed set and the guard tests.
