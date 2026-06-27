/**
 * UserService — typed service layer for user queries.
 *
 * Wraps raw Drizzle queries that extensions previously did inline.
 * Extensions should use this instead of importing db/schema directly.
 */

import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
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
  get(id: string): Promise<UserInfo | null>;
  /** Ensure a user exists — inserts with displayName=id if missing. Returns the user. */
  ensureExists(id: string): Promise<UserInfo>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type UsersSchema = typeof usersTable;

export class UserServiceImpl implements UserService {
  constructor(
    private getDb: () => Promise<LibSQLDatabase<any>>,
    private users: UsersSchema,
  ) {}

  async get(id: string): Promise<UserInfo | null> {
    const db = await this.getDb();

    const row = await db
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

  async ensureExists(id: string): Promise<UserInfo> {
    const db = await this.getDb();
    const existing = await this.get(id);
    if (existing) return existing;

    const now = new Date().toISOString();
    await db.insert(this.users)
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
