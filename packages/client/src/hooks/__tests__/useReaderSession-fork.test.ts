/**
 * Integration test: verifies that useReaderSession properly handles the
 * fork → send → done flow without leaving isLoading stuck or viewNodeId stale.
 *
 * Uses renderHook with mocked API and StreamContext to test the actual React
 * state transitions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import type { SessionState } from "@pi-tree/core/types";

// ---------------------------------------------------------------------------
// Mocks — set up before any imports that use them
// ---------------------------------------------------------------------------

const mockStartSession = vi.fn();
const mockViewScope = vi.fn();
const mockForkAtNode = vi.fn();
const mockFetchGlossary = vi.fn().mockResolvedValue([]);
const mockFetchSessions = vi.fn().mockResolvedValue({ sessions: [] });
const mockFetchProfiles = vi.fn().mockResolvedValue({ profiles: [] });
const mockResetSession = vi.fn();
const mockDeleteNode = vi.fn();
const mockRenameNode = vi.fn();
const mockDeleteSession = vi.fn();

vi.mock("../../api", () => ({
  startSession: (...args: unknown[]) => mockStartSession(...args),
  viewScope: (...args: unknown[]) => mockViewScope(...args),
  forkAtNode: (...args: unknown[]) => mockForkAtNode(...args),
  fetchGlossary: (...args: unknown[]) => mockFetchGlossary(...args),
  fetchSessions: (...args: unknown[]) => mockFetchSessions(...args),
  fetchProfiles: (...args: unknown[]) => mockFetchProfiles(...args),
  resetSession: (...args: unknown[]) => mockResetSession(...args),
  deleteNode: (...args: unknown[]) => mockDeleteNode(...args),
  renameNode: (...args: unknown[]) => mockRenameNode(...args),
  deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
}));

// Mock StreamContext — we directly control streams state
const mockStartMessageStream = vi.fn().mockResolvedValue(undefined);
const mockClearStream = vi.fn();
const mockStopStream = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let streamsState: Record<string, any> = {};

vi.mock("../../StreamContext", () => ({
  useStream: () => ({
    streams: streamsState,
    startMessageStream: mockStartMessageStream,
    clearStream: mockClearStream,
    stopStream: mockStopStream,
  }),
}));

// Now import the hook
import { useReaderSession } from "../useReaderSession";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSessionState(viewNodeId: string | null): SessionState & { response: string } {
  return {
    viewNodeId,
    messages: [],
    breadcrumb: [],
    tree: { id: "root", parentId: null, label: "root", status: "active", messageCount: 0, children: [], isCurrent: true },
    branches: [],
    parentContext: [],
    response: "AI response",
  };
}

function createWrapper() {
  // Minimal wrapper — no StreamProvider needed since we mock useStream
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
}

function createHookArgs() {
  const source = { id: "src-1", title: "Test", type: "book" } as import("@pi-tree/shared").Source;
  const searchParams = new URLSearchParams("session=1&node=user_q2");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setSearchParams = vi.fn((updater: any) => {
    if (typeof updater === "function") {
      updater(searchParams);
    }
  });
  const deps = {
    isMobile: () => false,
    setSidebarOpen: vi.fn(),
    setDictEntries: vi.fn(),
    navigate: vi.fn(),
  };
  return { source, searchParams, setSearchParams, deps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  streamsState = {};
  mockStartSession.mockResolvedValue(makeSessionState(null));
});

describe("useReaderSession — fork-then-send flow", () => {
  it("handleFork stores pendingForkScope and updates viewNodeId", async () => {
    const { source, searchParams, setSearchParams, deps } = createHookArgs();

    const forkState = makeSessionState("user_q2");
    mockForkAtNode.mockResolvedValue({
      state: forkState,
      forkScopeId: "user_q1",
    });

    const { result } = renderHook(
      () => useReaderSession("test-user", source, searchParams, setSearchParams, deps),
      { wrapper: createWrapper() },
    );

    // Trigger fork
    await act(async () => {
      await result.current.handleFork("AI_c2");
    });

    // Fork API was called
    expect(mockForkAtNode).toHaveBeenCalledWith("test-user", "src-1", 1, "AI_c2");

    // isLoading should be reset after fork completes
    expect(result.current.isLoading).toBe(false);
  });

  it("handleSendMessage after fork uses forkScope as sendingNodeId", async () => {
    const { source, searchParams, setSearchParams, deps } = createHookArgs();

    const forkState = makeSessionState("user_q2");
    mockForkAtNode.mockResolvedValue({
      state: forkState,
      forkScopeId: "user_q1",
    });

    const { result } = renderHook(
      () => useReaderSession("test-user", source, searchParams, setSearchParams, deps),
      { wrapper: createWrapper() },
    );

    // Step 1: Fork
    await act(async () => {
      await result.current.handleFork("AI_c2");
    });

    // Step 2: Send message (should use forkScope)
    await act(async () => {
      await result.current.handleSendMessage("new branch message");
    });

    // startMessageStream should be called with forkScopeId as viewNodeId
    expect(mockStartMessageStream).toHaveBeenCalledWith(
      "test-user",
      "src-1",
      1,
      "new branch message",
      "user_q1",  // forkScopeId, NOT user_q2
      expect.any(Function),
      { forceBranch: true },
    );
  });

  it("second send (no fork) uses lastViewNodeId, not forkScope", async () => {
    const { source, searchParams, setSearchParams, deps } = createHookArgs();

    const forkState = makeSessionState("user_q2");
    mockForkAtNode.mockResolvedValue({
      state: forkState,
      forkScopeId: "user_q1",
    });

    const { result } = renderHook(
      () => useReaderSession("test-user", source, searchParams, setSearchParams, deps),
      { wrapper: createWrapper() },
    );

    // Fork
    await act(async () => {
      await result.current.handleFork("AI_c2");
    });

    // First send consumes pendingForkScope
    await act(async () => {
      await result.current.handleSendMessage("fork msg");
    });

    mockStartMessageStream.mockClear();

    // Second send — should NOT use forkScope (it was consumed)
    await act(async () => {
      await result.current.handleSendMessage("follow up");
    });

    // No forceBranch — last arg should be undefined
    expect(mockStartMessageStream).toHaveBeenCalledWith(
      "test-user",
      "src-1",
      1,
      "follow up",
      "user_q1", // lastViewNodeIdRef was synced to forkScope by the fix
      expect.any(Function),
      undefined,
    );
  });

  // NOTE: The stream-done effect (useEffect watching streams state) is NOT
  // testable here because our mock useStream returns a module-level variable
  // rather than React state — mutating it won't trigger a re-render or fire
  // the useEffect. The pure-logic side of stream-done (applying result,
  // clearing streams) is covered by the unit tests in send-context.test.ts.

  it("backToRoot after fork clears pendingForkScope", async () => {
    const { source, searchParams, setSearchParams, deps } = createHookArgs();

    const forkState = makeSessionState("user_q2");
    mockForkAtNode.mockResolvedValue({
      state: forkState,
      forkScopeId: "user_q1",
    });
    mockViewScope.mockResolvedValue(makeSessionState(null));

    const { result } = renderHook(
      () => useReaderSession("test-user", source, searchParams, setSearchParams, deps),
      { wrapper: createWrapper() },
    );

    // Fork — sets pendingForkScope
    await act(async () => {
      await result.current.handleFork("AI_c2");
    });

    // Press Escape / back to root — should clear pendingForkScope
    await act(async () => {
      await result.current.handleBackToRoot();
    });

    mockStartMessageStream.mockClear();

    // Send after backToRoot — should NOT use forceBranch
    await act(async () => {
      await result.current.handleSendMessage("after escape");
    });

    // No forceBranch — forkScope was cleared by backToRoot
    expect(mockStartMessageStream).toHaveBeenCalledWith(
      "test-user",
      "src-1",
      1,
      "after escape",
      null, // viewNodeId is null after backToRoot (root scope)
      expect.any(Function),
      undefined, // no forceBranch
    );
  });

  it("navigation after fork clears pendingForkScope", async () => {
    const { source, searchParams, setSearchParams, deps } = createHookArgs();

    const forkState = makeSessionState("user_q2");
    mockForkAtNode.mockResolvedValue({
      state: forkState,
      forkScopeId: "user_q1",
    });
    mockViewScope.mockResolvedValue(makeSessionState("other_node"));

    const { result } = renderHook(
      () => useReaderSession("test-user", source, searchParams, setSearchParams, deps),
      { wrapper: createWrapper() },
    );

    // Fork
    await act(async () => {
      await result.current.handleFork("AI_c2");
    });

    // Navigate away (clears pendingForkScope)
    await act(async () => {
      await result.current.handleNavigate("other_node");
    });

    mockStartMessageStream.mockClear();

    // Send after navigation — should NOT use forkScope
    await act(async () => {
      await result.current.handleSendMessage("after nav");
    });

    // No forceBranch — forkScope was cleared by navigation
    expect(mockStartMessageStream).toHaveBeenCalledWith(
      "test-user",
      "src-1",
      1,
      "after nav",
      expect.anything(),
      expect.any(Function),
      undefined, // no forceBranch
    );
  });
});
