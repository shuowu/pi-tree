import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Book,
  BookSession,
  ChatMessage,
  BreadcrumbItem,
  TreeNodeView,
  BranchOption,
} from "@pi-books/shared";
import {
  startSession,
  resetSession,
  sendMessageStreaming,
  viewScope,
  fetchGlossary,
  deleteNode,
  renameNode,
  fetchSessions,
  createSession,
  updateSession,
  deleteSession as deleteSessionApi,
} from "../api";
import type { SessionMode } from "../components/WelcomeState";
import type { DictEntry } from "../components/DictionaryPanel";

interface UseReaderSessionDeps {
  isMobile: () => boolean;
  setSidebarOpen: (open: boolean) => void;
  setDictEntries: React.Dispatch<React.SetStateAction<DictEntry[]>>;
}

export function useReaderSession(
  userId: string | null,
  book: Book,
  searchParams: URLSearchParams,
  setSearchParams: ReturnType<typeof import("react-router").useSearchParams>[1],
  deps: UseReaderSessionDeps,
) {
  const { isMobile, setSidebarOpen, setDictEntries } = deps;

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------

  const [sessionId, setSessionId] = useState<number | null>(() => {
    const param = searchParams.get("session");
    return param ? Number(param) : null;
  });
  const [sessions, setSessions] = useState<BookSession[]>([]);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [tree, setTree] = useState<TreeNodeView | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [activeToolCall, setActiveToolCall] = useState<{ toolName: string; args: Record<string, unknown> } | null>(null);

  const initialized = useRef(false);
  // Track the last viewNodeId we set programmatically, so we can detect
  // browser-initiated changes (back/forward) vs our own updates.
  const lastViewNodeIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<number | null>(sessionId);

  // Keep ref in sync
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Derive viewNodeId from URL search params — single source of truth
  const viewNodeId = searchParams.get("node") ?? null;

  /** Update the URL ?session= and ?node= params */
  const updateUrl = useCallback(
    (nodeId: string | null, sid: number | null, replace: boolean) => {
      lastViewNodeIdRef.current = nodeId;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nodeId) {
            next.set("node", nodeId);
          } else {
            next.delete("node");
          }
          if (sid !== null) {
            next.set("session", String(sid));
          } else {
            next.delete("session");
          }
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  /** Apply session data to React state only (no URL update) */
  const applySessionData = useCallback(
    (state: {
      messages: ChatMessage[];
      breadcrumb: BreadcrumbItem[];
      tree: TreeNodeView;
      branches: BranchOption[];
    }) => {
      setMessages(state.messages);
      setBreadcrumb(state.breadcrumb);
      setTree(state.tree);
      setBranches(state.branches);
    },
    [],
  );

  const handleSendMessage = useCallback(
    async (message: string) => {
      if (!userId) return;
      const sid = sessionIdRef.current;
      if (sid === null) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setStreamingContent("");

      await sendMessageStreaming(userId, book.id, sid, message, lastViewNodeIdRef.current, {
        onToken: (token) => {
          // Clear tool call indicator — real output is arriving
          setActiveToolCall(null);
          setStreamingContent((prev) => (prev ?? "") + token);
        },
        onTurnEnd: () => {
          // Agent finished an intermediate turn (e.g. "Let me look that up…"
          // before a tool call). Clear the streaming buffer so only the
          // final turn's real answer is displayed.
          setStreamingContent("");
        },
        onToolCall: (info) => {
          setActiveToolCall(info);
        },
        onCompaction: (compacting) => {
          setIsCompacting(compacting);
        },
        onTreeUpdate: (updatedTree) => {
          setTree(updatedTree);
        },
        onDone: (result) => {
          setStreamingContent(null);
          setIsLoading(false);
          setIsCompacting(false);
          setActiveToolCall(null);
          applySessionData(result);
          // Server may have changed the active node — replace (not push)
          updateUrl(result.viewNodeId, sid, true);
        },
        onError: (err) => {
          setStreamingContent(null);
          setIsLoading(false);
          setIsCompacting(false);
          setActiveToolCall(null);
          const errorMsg: ChatMessage = {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `⚠️ Error: ${err.message}`,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMsg]);
        },
      });
    },
    [userId, book.id, applySessionData, updateUrl],
  );

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const handleNavigate = useCallback(
    async (nodeId: string) => {
      if (!userId) return;
      const sid = sessionIdRef.current;
      if (sid === null) return;

      // Auto-close sidebar on mobile after navigating
      if (isMobile()) {
        setSidebarOpen(false);
      }

      setIsLoading(true);
      try {
        // Empty nodeId = navigate to root
        const state = await viewScope(userId, book.id, sid, nodeId || null);
        applySessionData(state);
        updateUrl(state.viewNodeId, sid, false); // push history entry
      } catch (err) {
        console.error("Navigate failed:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [userId, book.id, applySessionData, updateUrl, isMobile, setSidebarOpen],
  );

  const handleBackToRoot = useCallback(async () => {
    if (!userId) return;
    const sid = sessionIdRef.current;
    if (sid === null) return;

    setIsLoading(true);
    try {
      const state = await viewScope(userId, book.id, sid, null);
      applySessionData(state);
      updateUrl(state.viewNodeId, sid, false); // push history entry
    } catch (err) {
      console.error("Back to root failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [userId, book.id, applySessionData, updateUrl]);

  // ---------------------------------------------------------------------------
  // Session management: select, create, rename, delete
  // ---------------------------------------------------------------------------

  /** Load a specific session by ID and update URL */
  const loadSession = useCallback(
    async (sid: number, initialNodeId?: string | null) => {
      if (!userId) return;
      setIsLoading(true);
      setShowSessionPicker(false);
      setSessionId(sid);

      try {
        const state = await startSession(userId, book.id, sid);

        // Load persisted glossary entries from DB
        try {
          const saved = await fetchGlossary(userId, book.id);
          if (saved.length > 0) {
            setDictEntries(saved.map((e) => ({
              id: `saved-${e.id}`,
              term: e.term,
              definition: e.definition ?? "",
              streaming: false,
              timestamp: e.createdAt,
            })));
          }
        } catch {
          // Glossary load failed — non-critical, continue
        }

        if (state.messages.length > 0) {
          // Existing session with messages — restore it
          if (initialNodeId) {
            try {
              const scopedState = await viewScope(userId, book.id, sid, initialNodeId);
              applySessionData(scopedState);
              updateUrl(scopedState.viewNodeId, sid, true);
            } catch {
              // Node not found — fall back to server default
              applySessionData(state);
              updateUrl(state.viewNodeId, sid, true);
            }
          } else {
            applySessionData(state);
            updateUrl(state.viewNodeId, sid, true);
          }
        } else {
          // Fresh session (just created) — no messages yet, URL already updated
          updateUrl(null, sid, true);
        }
      } catch (err) {
        console.error("Load session failed:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [userId, book.id, applySessionData, updateUrl, setDictEntries],
  );

  /** User selected an existing session from the picker */
  const handleSelectSession = useCallback(
    (session: BookSession) => {
      loadSession(session.id);
    },
    [loadSession],
  );

  /** User wants to create a new session with a chosen mode */
  const handleNewSession = useCallback(
    async (mode: SessionMode) => {
      if (!userId) return;
      setIsLoading(true);

      try {
        const title = mode === "reading" ? "Interactive Reading" : "Freeform Q&A";
        const newSession = await createSession(userId, book.id, title, { mode });

        // Add to local sessions list
        setSessions((prev) => [newSession, ...prev]);
        setSessionId(newSession.id);
        setShowSessionPicker(false);
        updateUrl(null, newSession.id, true);

        // Start the session on the server
        await startSession(userId, book.id, newSession.id);

        // Send the initial mode-specific message
        // We need sessionIdRef to be updated before calling handleSendMessage,
        // so set it directly here
        sessionIdRef.current = newSession.id;

        setIsLoading(false);

        if (mode === "reading") {
          handleSendMessage(
            `Let's start reading "${book.title}" by ${book.author}. Give me a chapter briefing to begin.`,
          );
        } else {
          handleSendMessage(
            `I'd like to explore "${book.title}" by ${book.author} through Q&A. I'll ask questions about the book — its themes, arguments, key passages, and ideas. Start by briefly introducing the book's main thesis in 2-3 sentences, then let me lead with questions.`,
          );
        }
      } catch (err) {
        console.error("Create session failed:", err);
        setIsLoading(false);
      }
    },
    [userId, book, handleSendMessage, updateUrl],
  );

  /** Rename a session */
  const handleRenameSession = useCallback(
    async (sid: number, newTitle: string) => {
      if (!userId) return;
      try {
        await updateSession(userId, book.id, sid, { title: newTitle });
        setSessions((prev) =>
          prev.map((s) => (s.id === sid ? { ...s, title: newTitle } : s)),
        );
      } catch (err) {
        console.error("Rename session failed:", err);
      }
    },
    [userId, book.id],
  );

  /** Delete a session */
  const handleDeleteSession = useCallback(
    async (sid: number) => {
      if (!userId) return;
      try {
        await deleteSessionApi(userId, book.id, sid);
        setSessions((prev) => prev.filter((s) => s.id !== sid));

        // If we deleted the active session, go back to the picker
        if (sessionId === sid) {
          setSessionId(null);
          setMessages([]);
          setTree(null);
          setBreadcrumb([]);
          setBranches([]);
          setShowSessionPicker(true);
          updateUrl(null, null, true);
        }
      } catch (err) {
        console.error("Delete session failed:", err);
      }
    },
    [userId, book.id, sessionId, updateUrl],
  );

  /** Go back to the session picker from within a session */
  const handleBackToSessions = useCallback(async () => {
    if (!userId) return;

    // Refresh sessions list
    try {
      const freshSessions = await fetchSessions(userId, book.id);
      setSessions(freshSessions);
    } catch {
      // keep existing list
    }

    setSessionId(null);
    setMessages([]);
    setTree(null);
    setBreadcrumb([]);
    setBranches([]);
    setShowSessionPicker(true);
    updateUrl(null, null, true);
  }, [userId, book.id, updateUrl]);

  // ---------------------------------------------------------------------------
  // Handle mode selection from WelcomeState / BookSetupState skip-to-chat
  // ---------------------------------------------------------------------------

  const handleSelectMode = useCallback(
    (mode: SessionMode) => {
      handleNewSession(mode);
    },
    [handleNewSession],
  );

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (!userId) return;
    const sid = sessionIdRef.current;
    if (sid === null) return;
    try {
      const state = await deleteNode(userId, book.id, sid, nodeId, viewNodeId);
      applySessionData(state);
      updateUrl(state.viewNodeId, sid, true);
    } catch (err) {
      console.error("Delete node failed:", err);
    }
  }, [userId, book.id, viewNodeId, applySessionData, updateUrl]);

  const handleRenameNode = useCallback(async (nodeId: string, newLabel: string) => {
    if (!userId) return;
    const sid = sessionIdRef.current;
    if (sid === null) return;
    try {
      const state = await renameNode(userId, book.id, sid, nodeId, newLabel, viewNodeId);
      applySessionData(state);
    } catch (err) {
      console.error("Rename node failed:", err);
    }
  }, [userId, book.id, viewNodeId, applySessionData]);

  const handleResetSession = useCallback(async () => {
    if (!userId) return;
    const sid = sessionIdRef.current;
    if (sid === null) {
      if (!confirm("No active session. Go back to session picker?")) return;
      handleBackToSessions();
      return;
    }
    if (!confirm("Clear this session? All conversation history will be lost.")) return;
    try {
      await resetSession(userId, book.id, sid);
      // Full reload to get a clean slate
      window.location.href = `/book/${book.id}?session=${sid}`;
    } catch (err) {
      console.error("Reset failed:", err);
    }
  }, [userId, book.id, handleBackToSessions]);

  // ---------------------------------------------------------------------------
  // On mount: fetch sessions list, then decide what to show
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (initialized.current) return;
    if (!userId) return;
    initialized.current = true;

    const initialSessionId = searchParams.get("session");
    const initialNodeId = searchParams.get("node") ?? null;
    lastViewNodeIdRef.current = initialNodeId;

    (async () => {
      setIsLoading(true);
      try {
        // Fetch sessions list for this user+book
        const sessionsList = await fetchSessions(userId, book.id);
        setSessions(sessionsList);
        setSessionsLoaded(true);

        if (initialSessionId) {
          // URL has ?session= — load that specific session
          const sid = Number(initialSessionId);
          setSessionId(sid);
          await loadSession(sid, initialNodeId);
        } else if (sessionsList.length > 0) {
          // Sessions exist but no param — show picker
          setIsLoading(false);
          setShowSessionPicker(true);
        } else {
          // No sessions at all — show picker (which shows "Start New Session" mode)
          setIsLoading(false);
          setShowSessionPicker(true);
        }
      } catch {
        setIsLoading(false);
        setShowSessionPicker(true);
        setSessionsLoaded(true);
      }
    })();
  }, [userId, book, loadSession, searchParams]);

  // React to browser back/forward: when viewNodeId changes from a popstate
  // (not from our own programmatic update), re-fetch the node data.
  useEffect(() => {
    if (!initialized.current) return;
    if (!userId) return;
    const sid = sessionIdRef.current;
    if (sid === null) return;
    if (viewNodeId === lastViewNodeIdRef.current) return;

    // Browser navigation happened — sync state
    lastViewNodeIdRef.current = viewNodeId;
    (async () => {
      setIsLoading(true);
      try {
        const state = await viewScope(userId, book.id, sid, viewNodeId);
        applySessionData(state);
      } catch (err) {
        console.error("Browser nav restore failed:", err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [viewNodeId, userId, book.id, applySessionData]);

  // Escape key: go back one scope level
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && viewNodeId) {
        e.preventDefault();
        handleBackToRoot();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [viewNodeId, handleBackToRoot]);

  // Find the current session title for the breadcrumb
  const activeSession = sessions.find((s) => s.id === sessionId);
  const sessionLabel = activeSession?.title ?? null;

  return {
    sessionId,
    sessions,
    showSessionPicker,
    sessionsLoaded,
    messages,
    isLoading,
    breadcrumb,
    tree,
    branches,
    streamingContent,
    isCompacting,
    activeToolCall,
    viewNodeId,
    sessionLabel,
    handleSendMessage,
    handleNavigate,
    handleBackToRoot,
    handleSelectSession,
    handleNewSession,
    handleRenameSession,
    handleDeleteSession,
    handleBackToSessions,
    handleSelectMode,
    handleDeleteNode,
    handleRenameNode,
    handleResetSession,
  };
}
