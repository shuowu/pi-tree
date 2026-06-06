/**
 * SessionStore — keeps active TreeManager instances in memory per user+book+session.
 *
 * Without this, every request creates a new Pi session (new JSONL file).
 * This store ensures one session per user+book+session, reused across requests.
 *
 * Multi-session support: the composite key is now `userId:bookId:sessionId`.
 * When sessionId is undefined, we fall back to the legacy `userId:bookId` key
 * and log a deprecation warning so callers can be updated incrementally.
 */

import { TreeManager } from "./tree-manager.js";

const activeSessions = new Map<string, TreeManager>();

/** Composite key for the session store */
function sessionKey(userId: string, bookId: string, sessionId?: number): string {
  if (sessionId !== undefined) {
    return `${userId}:${bookId}:${sessionId}`;
  }
  // Legacy fallback — callers that haven't been updated yet
  return `${userId}:${bookId}`;
}

/**
 * Get or create a session for a user+book+session triple.
 * The first call creates the session; subsequent calls return the same instance.
 *
 * @param sessionId — DB row ID of the session. When provided, loads that
 *   specific session. When omitted, loads the most recently active session
 *   for the user+book (backward compatible).
 */
export async function getSession(
  userId: string,
  bookId: string,
  sessionId?: number,
): Promise<TreeManager> {
  if (sessionId === undefined) {
    console.warn(
      `[session-store] getSession called without sessionId for ${userId}/${bookId} — using legacy key`,
    );
  }

  const key = sessionKey(userId, bookId, sessionId);
  let manager = activeSessions.get(key);
  if (!manager) {
    manager = await TreeManager.loadOrCreate(userId, bookId, { sessionId });
    activeSessions.set(key, manager);
  }
  return manager;
}

/**
 * Remove a session from the store (e.g., when user leaves a book).
 */
export function closeSession(userId: string, bookId: string, sessionId?: number): void {
  if (sessionId !== undefined) {
    activeSessions.delete(sessionKey(userId, bookId, sessionId));
  } else {
    // Legacy: also try the old key format
    activeSessions.delete(sessionKey(userId, bookId));
  }
}

/**
 * List all active session keys (userId:bookId or userId:bookId:sessionId).
 */
export function listSessions(): string[] {
  return [...activeSessions.keys()];
}
