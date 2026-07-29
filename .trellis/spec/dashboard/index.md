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
