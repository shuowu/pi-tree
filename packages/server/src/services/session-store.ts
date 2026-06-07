/**
 * SessionStore — keeps active TreeManager instances in memory per user+book+session.
 *
 * Without this, every request creates a new Pi session (new JSONL file).
 * This store ensures one session per user+book+session, reused across requests.
 *
 * Multi-session support: the composite key is now `userId:bookId:sessionId`.
 * When sessionId is undefined, we fall back to the legacy `userId:bookId` key
 * and log a deprecation warning so callers can be updated incrementally.
 *
 * Concurrency: A per-session mutex ensures only one prompt() runs at a time
 * per session. An AbortController per session allows cancelling in-flight
 * streams when a new request arrives.
 */

import { TreeManager } from "./tree-manager.js";

// ---------------------------------------------------------------------------
// Session cache
// ---------------------------------------------------------------------------

const activeSessions = new Map<string, TreeManager>();

/** Composite key for the session store */
function sessionKey(userId: string, bookId: string, sessionId?: number): string {
  if (sessionId !== undefined) {
    return `${userId}:${bookId}:${sessionId}`;
  }
  // Legacy fallback — callers that haven't been updated yet
  return `${userId}:${bookId}`;
}

// ---------------------------------------------------------------------------
// Per-session mutex — serializes concurrent requests to the same session
// ---------------------------------------------------------------------------

/**
 * Simple async mutex. Each `acquire()` returns a `release` function.
 * Callers queue behind each other via a promise chain.
 */
class SessionLock {
  private tail: Promise<void> = Promise.resolve();

  /** Wait for any in-flight operation, then hold the lock. */
  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Wait for the previous holder, then let caller proceed.
    // The caller releases by calling the returned function.
    const gate = this.tail;
    this.tail = next;
    return gate.then(() => release);
  }
}

const sessionLocks = new Map<string, SessionLock>();

/** Get or create the lock for a session key */
function getLock(key: string): SessionLock {
  let lock = sessionLocks.get(key);
  if (!lock) {
    lock = new SessionLock();
    sessionLocks.set(key, lock);
  }
  return lock;
}

// ---------------------------------------------------------------------------
// Per-session AbortController — cancels in-flight streams
// ---------------------------------------------------------------------------

const sessionAbortControllers = new Map<string, AbortController>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
 * Run `fn` exclusively on the session's TreeManager.
 *
 * Acquires a per-session lock so only one prompt/operation runs at a time.
 * This prevents concurrent agent.prompt() calls from corrupting the session.
 */
export async function withSessionLock<T>(
  userId: string,
  bookId: string,
  sessionId: number | undefined,
  fn: (manager: TreeManager) => Promise<T>,
): Promise<T> {
  const key = sessionKey(userId, bookId, sessionId);
  const lock = getLock(key);
  const release = await lock.acquire();
  try {
    const manager = await getSession(userId, bookId, sessionId);
    return await fn(manager);
  } finally {
    release();
  }
}

/**
 * Abort any in-flight stream for a session and create a fresh AbortController.
 *
 * Call this BEFORE acquiring the session lock when a new request arrives —
 * the abort will cause the in-flight prompt to error out and release the lock,
 * allowing the new request to proceed.
 */
export function abortSession(userId: string, bookId: string, sessionId?: number): void {
  const key = sessionKey(userId, bookId, sessionId);
  const existing = sessionAbortControllers.get(key);
  if (existing) {
    existing.abort();
  }
  sessionAbortControllers.set(key, new AbortController());
}

/**
 * Get the current AbortSignal for a session.
 * Returns a fresh signal if none exists yet.
 */
export function getSessionAbortSignal(userId: string, bookId: string, sessionId?: number): AbortSignal {
  const key = sessionKey(userId, bookId, sessionId);
  let controller = sessionAbortControllers.get(key);
  if (!controller) {
    controller = new AbortController();
    sessionAbortControllers.set(key, controller);
  }
  return controller.signal;
}

/**
 * Remove a session from the store (e.g., when user leaves a book).
 * Also cleans up the lock and abort controller for the session.
 */
export function closeSession(userId: string, bookId: string, sessionId?: number): void {
  if (sessionId !== undefined) {
    const key = sessionKey(userId, bookId, sessionId);
    activeSessions.delete(key);
    sessionLocks.delete(key);
    const ac = sessionAbortControllers.get(key);
    if (ac) ac.abort();
    sessionAbortControllers.delete(key);
  } else {
    // Legacy: also try the old key format
    const key = sessionKey(userId, bookId);
    activeSessions.delete(key);
    sessionLocks.delete(key);
    const ac = sessionAbortControllers.get(key);
    if (ac) ac.abort();
    sessionAbortControllers.delete(key);
  }
}

/**
 * List all active session keys (userId:bookId or userId:bookId:sessionId).
 */
export function listSessions(): string[] {
  return [...activeSessions.keys()];
}
