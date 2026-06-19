/**
 * UserService — typed service layer for user queries.
 *
 * Wraps raw Drizzle queries that extensions previously did inline.
 * Extensions should use this instead of importing db/schema directly.
 */

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { users as usersTable } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UserInfo {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface UserService {
  /** Get a user by ID. Returns null if not found. */
  get(id: string): UserInfo | null;
  /** Ensure a user exists — inserts with displayName=id if missing. Returns the user. */
  ensureExists(id: string): UserInfo;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type UsersSchema = typeof usersTable;

export class UserServiceImpl implements UserService {
  constructor(
    private getDb: () => BetterSQLite3Database<any>,
    private users: UsersSchema,
  ) {}

  get(id: string): UserInfo | null {
    const db = this.getDb();

    const row = db
      .select({
        id: this.users.id,
        displayName: this.users.displayName,
        avatarUrl: this.users.avatarUrl,
      })
      .from(this.users)
      .where(eq(this.users.id, id))
      .get();

    return row ?? null;
  }

  ensureExists(id: string): UserInfo {
    const db = this.getDb();
    const existing = this.get(id);
    if (existing) return existing;

    const now = new Date().toISOString();
    db.insert(this.users)
      .values({
        id,
        displayName: id,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return { id, displayName: id };
  }
}
