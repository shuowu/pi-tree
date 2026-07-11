/**
 * Session store unit tests — covers the ephemeral session APIs
 * (registerSession, getSessionByKey, closeSessionByKey, withSessionLockByKey)
 * and the existing key-based session lifecycle.
 *
 * Uses a minimal mock TreeManager stub — no Pi SDK, no DB, no env vars needed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerSession,
  getSessionByKey,
  closeSessionByKey,
  closeAllSessions,
  withSessionLockByKey,
  listSessions,
} from "../services/session-store.js";
import type { TreeManager } from "../services/tree-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal stub that satisfies the TreeManager type for store operations. */
function stubManager(label = "test"): TreeManager {
  return { _label: label } as unknown as TreeManager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Session Store — ephemeral session APIs", () => {
  const KEY = `test:ephemeral:${Date.now()}`;

  beforeEach(() => {
    // Clean up any leftover state from previous tests
    closeSessionByKey(KEY);
    closeSessionByKey("key-a");
    closeSessionByKey("key-b");
    closeSessionByKey("lock-test");
  });

  // ── registerSession / getSessionByKey ────────────────────────────────────

  it("registerSession stores and getSessionByKey retrieves", () => {
    const mgr = stubManager("router");
    registerSession(KEY, mgr);

    const retrieved = getSessionByKey(KEY);
    expect(retrieved).toBe(mgr);
  });

  it("getSessionByKey returns undefined for unknown key", () => {
    expect(getSessionByKey("nonexistent:key")).toBeUndefined();
  });

  it("registerSession overwrites an existing entry", () => {
    const mgr1 = stubManager("first");
    const mgr2 = stubManager("second");

    registerSession(KEY, mgr1);
    registerSession(KEY, mgr2);

    expect(getSessionByKey(KEY)).toBe(mgr2);
  });

  it("registered session appears in listSessions", () => {
    const mgr = stubManager();
    registerSession(KEY, mgr);

    expect(listSessions()).toContain(KEY);
  });

  // ── closeSessionByKey ────────────────────────────────────────────────────

  it("closeSessionByKey removes the session", () => {
    registerSession(KEY, stubManager());
    expect(getSessionByKey(KEY)).toBeDefined();

    closeSessionByKey(KEY);
    expect(getSessionByKey(KEY)).toBeUndefined();
  });

  it("closeSessionByKey removes from listSessions", () => {
    registerSession(KEY, stubManager());
    closeSessionByKey(KEY);

    expect(listSessions()).not.toContain(KEY);
  });

  it("closeSessionByKey is safe to call on nonexistent key", () => {
    // Should not throw
    expect(() => closeSessionByKey("does-not-exist")).not.toThrow();
  });

  // ── withSessionLockByKey ─────────────────────────────────────────────────

  it("withSessionLockByKey runs fn with the manager", async () => {
    const mgr = stubManager("locked");
    registerSession("lock-test", mgr);

    const result = await withSessionLockByKey("lock-test", async (m) => {
      expect(m).toBe(mgr);
      return 42;
    });

    expect(result).toBe(42);
  });

  it("withSessionLockByKey throws if key not found", async () => {
    await expect(
      withSessionLockByKey("missing-key", async () => "nope"),
    ).rejects.toThrow(/No session found/);
  });

  it("withSessionLockByKey serializes concurrent access", async () => {
    registerSession("lock-test", stubManager());
    const order: number[] = [];

    const p1 = withSessionLockByKey("lock-test", async () => {
      // Simulate async work
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });

    const p2 = withSessionLockByKey("lock-test", async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    // p1 acquires lock first, p2 waits → order is always [1, 2]
    expect(order).toEqual([1, 2]);
  });

  it("onQueued is NOT called when lock is uncontended", async () => {
    registerSession("lock-test", stubManager());
    const onQueued = vi.fn();

    await withSessionLockByKey("lock-test", async () => {
      // no-op
    }, onQueued);

    expect(onQueued).not.toHaveBeenCalled();
  });

  it("onQueued IS called when lock is contended", async () => {
    registerSession("lock-test", stubManager());
    const onQueued1 = vi.fn();
    const onQueued2 = vi.fn();

    const p1 = withSessionLockByKey("lock-test", async () => {
      await new Promise((r) => setTimeout(r, 50));
    }, onQueued1);

    const p2 = withSessionLockByKey("lock-test", async () => {
      // no-op
    }, onQueued2);

    await Promise.all([p1, p2]);
    // First caller gets the lock immediately → no contention callback
    expect(onQueued1).not.toHaveBeenCalled();
    // Second caller waits behind the first → contention callback fires
    expect(onQueued2).toHaveBeenCalledOnce();
  });

  // ── closeAllSessions ─────────────────────────────────────────────────────

  it("closeAllSessions evicts every cached session and reports the count", () => {
    // Start from a clean slate so the count assertion is exact
    closeAllSessions();

    registerSession("key-a", stubManager("A"));
    registerSession("key-b", stubManager("B"));

    const evicted = closeAllSessions();

    expect(evicted).toBe(2);
    expect(getSessionByKey("key-a")).toBeUndefined();
    expect(getSessionByKey("key-b")).toBeUndefined();
    expect(listSessions()).toEqual([]);
  });

  it("closeAllSessions on an empty store returns 0", () => {
    closeAllSessions();
    expect(closeAllSessions()).toBe(0);
  });

  // ── Multiple keys are independent ────────────────────────────────────────

  it("different keys are independent", () => {
    const mgrA = stubManager("A");
    const mgrB = stubManager("B");

    registerSession("key-a", mgrA);
    registerSession("key-b", mgrB);

    expect(getSessionByKey("key-a")).toBe(mgrA);
    expect(getSessionByKey("key-b")).toBe(mgrB);

    closeSessionByKey("key-a");
    expect(getSessionByKey("key-a")).toBeUndefined();
    expect(getSessionByKey("key-b")).toBe(mgrB);
  });
});
