/**
 * SessionService — typed service layer for session queries.
 *
 * Wraps raw Drizzle queries that extensions previously did inline.
 * Extensions should use this instead of importing db/schema directly.
 */

import { eq, and, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  userSessions as userSessionsTable,
  users as usersTable,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SessionInfo {
  id: number;
  title: string;
  context: string; // raw JSON string from DB
  lastActiveAt: string;
  sourceId: string;
  sessionFile: string;
}

export interface CreateSessionOpts {
  title: string;
  context: Record<string, any>;
  sessionFile?: string;
}

export interface SessionService {
  /** List active sessions for a user + source, ordered by most recent. */
  listForSource(userId: string, sourceId: string): SessionInfo[];
  /** Create a new session. Returns the created session info. */
  create(userId: string, sourceId: string, opts: CreateSessionOpts): SessionInfo;
  /** Resolve the userId that owns a given session file path. */
  resolveUserId(sessionFile: string): string | undefined;
  /** Look up a single session by its numeric ID. */
  getById(sessionId: number): SessionInfo | null;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type UserSessionsSchema = typeof userSessionsTable;
type UsersSchema = typeof usersTable;

export class SessionServiceImpl implements SessionService {
  constructor(
    private getDb: () => BetterSQLite3Database<any>,
    private userSessions: UserSessionsSchema,
    private users: UsersSchema,
  ) {}

  listForSource(userId: string, sourceId: string): SessionInfo[] {
    const db = this.getDb();
    const us = this.userSessions;

    return db
      .select({
        id: us.id,
        title: us.title,
        context: us.context,
        lastActiveAt: us.lastActiveAt,
        sourceId: us.sourceId,
        sessionFile: us.sessionFile,
      })
      .from(us)
      .where(
        and(
          eq(us.userId, userId),
          eq(us.sourceId, sourceId),
          eq(us.isActive, 1),
        ),
      )
      .orderBy(desc(us.lastActiveAt))
      .all() as SessionInfo[];
  }

  create(userId: string, sourceId: string, opts: CreateSessionOpts): SessionInfo {
    const db = this.getDb();
    const us = this.userSessions;
    const now = new Date().toISOString();
    const sessionFile = opts.sessionFile ?? `pending-${Date.now()}`;

    const result = db
      .insert(us)
      .values({
        userId,
        sourceId,
        title: opts.title,
        context: JSON.stringify(opts.context),
        sessionFile,
        isActive: 1,
        createdAt: now,
        lastActiveAt: now,
      })
      .run();

    const sessionId = Number(result.lastInsertRowid);

    return {
      id: sessionId,
      title: opts.title,
      context: JSON.stringify(opts.context),
      lastActiveAt: now,
      sourceId,
      sessionFile,
    };
  }

  resolveUserId(sessionFile: string): string | undefined {
    const db = this.getDb();
    const us = this.userSessions;

    const row = db
      .select({ userId: us.userId })
      .from(us)
      .where(eq(us.sessionFile, sessionFile))
      .get();

    return row?.userId;
  }

  getById(sessionId: number): SessionInfo | null {
    const db = this.getDb();
    const us = this.userSessions;

    const row = db
      .select({
        id: us.id,
        title: us.title,
        context: us.context,
        lastActiveAt: us.lastActiveAt,
        sourceId: us.sourceId,
        sessionFile: us.sessionFile,
      })
      .from(us)
      .where(eq(us.id, sessionId))
      .get();

    return (row as SessionInfo) ?? null;
  }
}

