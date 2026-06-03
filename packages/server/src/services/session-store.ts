/**
 * SessionStore — keeps active TreeManager instances in memory per book.
 *
 * Without this, every request creates a new Pi session (new JSONL file).
 * This store ensures one session per book, reused across requests.
 */

import { TreeManager } from "./tree-manager.js";

const activeSessions = new Map<string, TreeManager>();

/**
 * Get or create a session for a book.
 * The first call creates the session; subsequent calls return the same instance.
 */
export async function getSession(bookId: string): Promise<TreeManager> {
  let manager = activeSessions.get(bookId);
  if (!manager) {
    manager = await TreeManager.loadOrCreate(bookId);
    activeSessions.set(bookId, manager);
  }
  return manager;
}

/**
 * Remove a session from the store (e.g., when user leaves a book).
 */
export function closeSession(bookId: string): void {
  activeSessions.delete(bookId);
}

/**
 * List all active session book IDs.
 */
export function listSessions(): string[] {
  return [...activeSessions.keys()];
}
