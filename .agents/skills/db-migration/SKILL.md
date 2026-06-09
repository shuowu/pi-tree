---
name: db-migration
description: >
  Run a database migration after schema changes in packages/server/src/db/schema.ts.
  Invoke when the user asks to "run migration", "push schema", "update database",
  "db migrate", or after modifying schema.ts.
---

# Database Migration

Apply Drizzle ORM schema changes to the SQLite database.

## Pre-flight Checks

1. **Verify the schema file has changes**:
   ```bash
   git diff packages/server/src/db/schema.ts
   ```
   If no changes, confirm with the user what they want to do.

2. **Verify the dev server is running** — the database file must exist at `DATA_PATH` (default: `~/.local/share/pi-tree/pi-tree.db`):
   ```bash
   ls -la ~/.local/share/pi-tree/pi-tree.db
   ```

## Schema Change Checklist

Before pushing, verify these common issues:

- [ ] **New columns on existing tables**: Use `.default()` to avoid breaking existing rows
- [ ] **New tables**: Use `CREATE TABLE IF NOT EXISTS` pattern (Drizzle handles this)
- [ ] **Column renames**: Drizzle `push` treats these as drop + add — data will be lost. Use a manual migration instead
- [ ] **Type changes**: SQLite is flexible with types but verify no data truncation
- [ ] **New indexes**: Safe to add anytime
- [ ] **Foreign keys**: SQLite doesn't enforce FK by default — add `PRAGMA foreign_keys = ON` if needed

## Push the Schema

Run from the server package directory:

```bash
npm run db:push -w @pi-tree/server
```

This uses `drizzle-kit push` which:
- Compares `packages/server/src/db/schema.ts` against the live database
- Generates and applies ALTER TABLE statements
- Is safe for development (for production, use `drizzle-kit generate` + `drizzle-kit migrate` instead)

## Verify

1. **Check the push output** for any warnings about data loss.

2. **Inspect the database** (optional):
   ```bash
   npm run db:studio -w @pi-tree/server
   ```
   This opens Drizzle Studio in the browser to inspect tables and data.

3. **Restart the dev server** if it's running — the server caches the DB connection:
   ```bash
   tmux kill-session -t pi-tree && ./scripts/start-dev-tmux.sh
   ```

## Common Patterns

### Adding a new table

In `packages/server/src/db/schema.ts`:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const myNewTable = sqliteTable("my_new_table", {
  id: text("id").primaryKey(),
  someField: text("some_field").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
```

Then export it from `packages/server/src/db/index.ts` if needed by other modules.

### Adding a column to an existing table

Add with a `.default()` value so existing rows aren't broken:
```typescript
newColumn: text("new_column").default(""),
```

## Notes

- **Schema location**: `packages/server/src/db/schema.ts`
- **Drizzle config**: `packages/server/drizzle.config.ts`
- **DB file**: `<DATA_PATH>/pi-tree.db` (default: `~/.local/share/pi-tree/pi-tree.db`)
- **`db:push` is for development only** — it can drop columns. For production deployments, generate migration files with `drizzle-kit generate`.
