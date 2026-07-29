# Persistence

## Architecture

SQLite with an adapter fallback chain: `bun:sqlite` → `better-sqlite3` → `node:sqlite` → `sql.js` (always works).

Reference: `src/lib/db/driver.js` — adapter resolution and caching in `global._dbAdapter`

## File Layout

```
src/lib/db/
  driver.js      — adapter chain + global cache
  index.js       — barrel export of all repo functions
  schema.js      — TABLES definitions, SCHEMA_VERSION, buildCreateTableSql()
  migrate.js     — versioned migration runner + legacy JSON import
  paths.js       — DATA_DIR, DATA_FILE, DB_DIR
  backup.js      — pre-schema-change backup
  repos/         — 11 per-entity repository modules
  migrations/    — ordered migration files (001-initial.js, index.js)
  adapters/      — 4 adapter implementations
  helpers/       — jsonCol.js, metaStore.js
```

## Usage Pattern

Import from `@/lib/db/index.js` (or `@/lib/localDb.js` for backward compat):

```javascript
import { getSetting, setSetting, listConnections } from "@/lib/db/index.js";
```

All repo functions accept the db adapter as first argument (injected by callers or resolved automatically).

## Adding a New Repo

1. Create `src/lib/db/repos/<entity>Repo.js`
2. Export functions: `getXxx(db, id)`, `listXxx(db)`, `createXxx(db, data)`, `updateXxx(db, id, data)`, `deleteXxx(db, id)`
3. Re-export from `src/lib/db/index.js`

## Migrations

Schema changes go in `src/lib/db/migrations/`. Files are numbered (`001-initial.js`, `002-xxx.js`). Each exports:

```javascript
export async function up(db) { ... }
```

The migration runner (`migrate.js`) executes on startup. Additive schema sync handles tables that exist but are missing from `TABLES` definitions.

Reference: `src/lib/db/migrations/001-initial.js`, `src/lib/db/migrations/index.js`

## Data Location

- SQLite DB: `~/.9router/db.sqlite` (or `$DATA_DIR/db.sqlite`)
- Usage logs: `~/.9router/usage.json` + `log.txt` (does NOT follow `DATA_DIR`)

## Anti-patterns

- Don't write raw SQL in route handlers — use repo functions
- Don't import adapter files directly — use `index.js` barrel
- Don't assume `better-sqlite3` is available — the sql.js fallback always works
