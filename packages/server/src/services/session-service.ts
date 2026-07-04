/**
 * SessionService — typed service layer for session queries.
 *
 * Wraps raw Drizzle queries that extensions previously did inline.
 * Extensions should use this instead of importing db/schema directly.
 */

import { eq, and, desc } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
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
  listForSource(userId: string, sourceId: string): Promise<SessionInfo[]>;
  /** Create a new session. Returns the created session info. */
  create(userId: string, sourceId: string, opts: CreateSessionOpts): Promise<SessionInfo>;
  /** Resolve the userId that owns a given session file path. */
  resolveUserId(sessionFile: string): Promise<string | undefined>;
  /** Resolve the session's numeric ID from its file path. */
  resolveSessionId(sessionFile: string): Promise<number | undefined>;
  /** Look up a single session by its numeric ID. */
  getById(sessionId: number): Promise<SessionInfo | null>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type UserSessionsSchema = typeof userSessionsTable;
type UsersSchema = typeof usersTable;

export class SessionServiceImpl implements SessionService {
  constructor(
    private getDb: () => Promise<LibSQLDatabase<any>>,
    private userSessions: UserSessionsSchema,
    private users: UsersSchema,
  ) {}

  async listForSource(userId: string, sourceId: string): Promise<SessionInfo[]> {
    const db = await this.getDb();
    const us = this.userSessions;

    return await db
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

  async create(userId: string, sourceId: string, opts: CreateSessionOpts): Promise<SessionInfo> {
    const db = await this.getDb();
    const us = this.userSessions;
    const now = new Date().toISOString();
    const sessionFile = opts.sessionFile ?? `pending-${Date.now()}`;

    const [inserted] = await db
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
      .returning({ id: us.id });

    const sessionId = inserted.id;

    return {
      id: sessionId,
      title: opts.title,
      context: JSON.stringify(opts.context),
      lastActiveAt: now,
      sourceId,
      sessionFile,
    };
  }

  async resolveUserId(sessionFile: string): Promise<string | undefined> {
    const db = await this.getDb();
    const us = this.userSessions;

    const row = await db
      .select({ userId: us.userId })
      .from(us)
      .where(eq(us.sessionFile, sessionFile))
      .get();

    return row?.userId;
  }

  async resolveSessionId(sessionFile: string): Promise<number | undefined> {
    const db = await this.getDb();
    const us = this.userSessions;

    const row = await db
      .select({ id: us.id })
      .from(us)
      .where(eq(us.sessionFile, sessionFile))
      .get();

    return row?.id;
  }

  async getById(sessionId: number): Promise<SessionInfo | null> {
    const db = await this.getDb();
    const us = this.userSessions;

    const row = await db
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
