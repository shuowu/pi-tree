---
name: db-migration
description: >
  Run a database migration after schema changes in packages/server/src/db/schema.ts.
  Invoke when the user asks to "run migration", "push schema", "update database",
  "db migrate", "add a column", "add a table", or after modifying schema.ts.
---

# Database Migration

Apply Drizzle ORM schema changes to the SQLite database.

## How Migrations Work

Migrations are **auto-generated** by `drizzle-kit` and **auto-applied** on server startup:

1. Developer edits `packages/server/src/db/schema.ts`
2. Developer runs `npm run db:generate -w @pi-tree/server` → drizzle-kit diffs schema.ts against the previous snapshot and generates a `.sql` file in `packages/server/drizzle/`
3. Developer reviews the generated SQL (**protection layer**) and commits it
4. On next startup, `migrate()` from drizzle-orm applies any pending SQL files automatically

**Users never run migrations manually** — they just pull a new Docker image or rebuild locally.

### Under the hood

- Migration SQL files live in `packages/server/drizzle/` (committed to git)
- Snapshots and journal metadata live in `packages/server/drizzle/meta/`
- Applied migrations are tracked in a `__drizzle_migrations` table (auto-created by drizzle-orm)
- The baseline migration (`0000_baseline.sql`) uses `IF NOT EXISTS` so it's safe on both fresh installs and existing databases

## Adding a New Migration

### Step 1: Edit the schema

```bash
$EDITOR packages/server/src/db/schema.ts
```

### Step 2: Generate the migration

```bash
npm run db:generate -w @pi-tree/server
# Optionally name it:
npm run db:generate -w @pi-tree/server -- --name=add-language-column
```

This creates a new file like `drizzle/0001_add-language-column.sql` with the SQL diff.

### Step 3: Review the generated SQL

Open the generated `.sql` file and verify:
- No unexpected `DROP` statements
- ALTER TABLE / CREATE TABLE looks correct
- For `ALTER TABLE ... ADD COLUMN`: SQLite doesn't support `IF NOT EXISTS` for columns. If you need idempotency, wrap with a try/catch in code or accept that re-running the migration file is safe (drizzle's migrator won't re-apply applied migrations)

> **Important**: For the baseline migration only, we manually added `IF NOT EXISTS` to all statements. Future incremental migrations don't need this — drizzle's `__drizzle_migrations` table prevents re-application.

### Step 4: Test

```bash
npm test -w @pi-tree/server -- src/__tests__/migration.test.ts
```

### Step 5: Commit

Commit both the schema change and the generated migration:
```bash
git add packages/server/src/db/schema.ts packages/server/drizzle/
git commit -m "feat: add language column to sources"
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/server/src/db/schema.ts` | Drizzle ORM schema definitions |
| `packages/server/src/db/index.ts` | DB connection + `migrate()` call on startup |
| `packages/server/drizzle/` | Generated migration SQL files + metadata |
| `packages/server/drizzle/meta/_journal.json` | Migration order and metadata |
| `packages/server/drizzle.config.ts` | Drizzle-kit config (schema path, output dir) |
| `packages/server/src/__tests__/migration.test.ts` | Migration tests |

## Available Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `db:generate` | `drizzle-kit generate` | Auto-detect schema changes → produce SQL |
| `db:push` | `drizzle-kit push` | Dev-only: push schema directly to DB (⚠️ can drop columns) |
| `db:studio` | `drizzle-kit studio` | Open Drizzle Studio UI to inspect tables |

Run with: `npm run <script> -w @pi-tree/server`

## Common Patterns

### Adding a new column

In `schema.ts`, add with a `.default()` value:
```typescript
language: text("language").default(""),
```

Then: `npm run db:generate -w @pi-tree/server`

Drizzle-kit will produce:
```sql
ALTER TABLE `sources` ADD `language` text DEFAULT '';
```

### Adding a new table

In `schema.ts`:
```typescript
export const bookmarks = sqliteTable("bookmarks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  sourceId: text("source_id").notNull(),
  nodeId: text("node_id").notNull(),
  createdAt: text("created_at").notNull(),
});
```

Then: `npm run db:generate -w @pi-tree/server`

### Column renames / drops

SQLite has limited support for renames and drops. Drizzle-kit will generate appropriate SQL (may involve recreating the table). Always review carefully.

## Plugin Databases

Plugin databases (e.g., `$DATA_PATH/plugins/news/news.db`) are managed independently by each plugin. When a plugin needs schema migration, apply the same `PRAGMA user_version` pattern or add drizzle migrations within the plugin.
