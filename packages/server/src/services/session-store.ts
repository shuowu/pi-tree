/**
 * SessionStore — keeps active TreeManager instances in memory per user+book.
 *
 * Without this, every request creates a new Pi session (new JSONL file).
 * This store ensures one session per user+book, reused across requests.
 */

import { TreeManager } from "./tree-manager.js";

const activeSessions = new Map<string, TreeManager>();

/** Composite key for the session store */
function sessionKey(userId: string, bookId: string): string {
  return `${userId}:${bookId}`;
}

/**
 * Get or create a session for a user+book pair.
 * The first call creates the session; subsequent calls return the same instance.
 */
export async function getSession(
  userId: string,
  bookId: string,
): Promise<TreeManager> {
  const key = sessionKey(userId, bookId);
  let manager = activeSessions.get(key);
  if (!manager) {
    manager = await TreeManager.loadOrCreate(userId, bookId);
    activeSessions.set(key, manager);
  }
  return manager;
}

/**
 * Remove a session from the store (e.g., when user leaves a book).
 */
export function closeSession(userId: string, bookId: string): void {
  activeSessions.delete(sessionKey(userId, bookId));
}

/**
 * List all active session keys (userId:bookId).
 */
export function listSessions(): string[] {
  return [...activeSessions.keys()];
}
