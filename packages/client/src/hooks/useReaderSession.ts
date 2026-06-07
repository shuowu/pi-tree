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
  deleteSession as deleteSessionApi,
} from "../api";
import type { DictEntry } from "../components/DictionaryPanel";

interface UseReaderSessionDeps {
  isMobile: () => boolean;
  setSidebarOpen: (open: boolean) => void;
  setDictEntries: React.Dispatch<React.SetStateAction<DictEntry[]>>;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

export function useReaderSession(
  userId: string | null,
  book: Book,
  searchParams: URLSearchParams,
  setSearchParams: ReturnType<typeof import("react-router").useSearchParams>[1],
  deps: UseReaderSessionDeps,
) {
  const { isMobile, setSidebarOpen, setDictEntries, navigate } = deps;

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------

  const [sessionId, setSessionId] = useState<number | null>(() => {
    const param = searchParams.get("session");
    return param ? Number(param) : null;
  });
  const [sessions, setSessions] = useState<BookSession[]>([]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [tree, setTree] = useState<TreeNodeView | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [isQueued, setIsQueued] = useState(false);
  const [activeToolCall, setActiveToolCall] = useState<{ toolName: string; args: Record<string, unknown> } | null>(null);
  // Track which tree nodes have in-flight AI responses (for tree spinner)
  const [generatingNodeIds, setGeneratingNodeIds] = useState<Set<string>>(new Set());

  const initialized = useRef(false);
  // Track the last viewNodeId we set programmatically, so we can detect
  // browser-initiated changes (back/forward) vs our own updates.
  const lastViewNodeIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<number | null>(sessionId);
  // Generation counter — incremented on each new message or navigation.
  // Stale streams (gen !== current) silently finish without updating UI.
  const streamGenRef = useRef(0);

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
          // Clean up the "new" param if present
          next.delete("new");
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

      // Bump the generation — any in-flight stream from a previous message
      // will keep running on the server (response gets saved) but its
      // callbacks become no-ops so it won't touch the UI.
      const gen = ++streamGenRef.current;

      // Track which node is generating (for tree panel spinner).
      // Use the current viewNodeId — that's the branch we're sending from.
      const sendingNodeId = lastViewNodeIdRef.current;
      if (sendingNodeId) {
        setGeneratingNodeIds((prev) => new Set(prev).add(sendingNodeId));
      }

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
          if (gen !== streamGenRef.current) return;
          setIsQueued(false);
          setActiveToolCall(null);
          setStreamingContent((prev) => (prev ?? "") + token);
        },
        onTurnEnd: () => {
          if (gen !== streamGenRef.current) return;
          setStreamingContent("");
        },
        onToolCall: (info) => {
          if (gen !== streamGenRef.current) return;
          setActiveToolCall(info);
        },
        onCompaction: (compacting) => {
          if (gen !== streamGenRef.current) return;
          setIsCompacting(compacting);
        },
        onQueued: () => {
          if (gen !== streamGenRef.current) return;
          setIsQueued(true);
        },
        onTreeUpdate: (updatedTree) => {
          if (gen !== streamGenRef.current) return;
          setTree(updatedTree);
        },
        onDone: (result) => {
          // Always clear from generating set (even if stale)
          if (sendingNodeId) {
            setGeneratingNodeIds((prev) => {
              const next = new Set(prev);
              next.delete(sendingNodeId);
              return next;
            });
          }
          if (gen !== streamGenRef.current) return;
          setStreamingContent(null);
          setIsLoading(false);
          setIsCompacting(false);
          setIsQueued(false);
          setActiveToolCall(null);
          applySessionData(result);
          updateUrl(result.viewNodeId, sid, true);
        },
        onError: (err) => {
          // Always clear from generating set (even if stale)
          if (sendingNodeId) {
            setGeneratingNodeIds((prev) => {
              const next = new Set(prev);
              next.delete(sendingNodeId);
              return next;
            });
          }
          if (gen !== streamGenRef.current) return;
          setStreamingContent(null);
          setIsLoading(false);
          setIsCompacting(false);
          setIsQueued(false);
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

      // Detach from any in-flight stream — bump the generation so the
      // old stream's callbacks become no-ops.  The server keeps running
      // the prompt and saves the response; user will see it when they
      // navigate back.
      streamGenRef.current++;
      setStreamingContent(null);
      setIsCompacting(false);
      setIsQueued(false);
      setActiveToolCall(null);

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
  // Session loading
  // ---------------------------------------------------------------------------

  /** Load a specific session by ID and update URL */
  const loadSession = useCallback(
    async (sid: number, initialNodeId?: string | null) => {
      if (!userId) return;
      setIsLoading(true);
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

  // ---------------------------------------------------------------------------
  // Session actions available from within the Reader
  // ---------------------------------------------------------------------------

  /** Delete a session (e.g. from settings modal) */
  const handleDeleteSession = useCallback(
    async (sid: number) => {
      if (!userId) return;
      try {
        await deleteSessionApi(userId, book.id, sid);

        // If we deleted the active session, navigate to sessions page
        if (sessionId === sid) {
          setSessionId(null);
          setMessages([]);
          setTree(null);
          setBreadcrumb([]);
          setBranches([]);
          navigate(`/book/${book.id}/sessions`, { replace: true });
        }
      } catch (err) {
        console.error("Delete session failed:", err);
      }
    },
    [userId, book.id, sessionId, navigate],
  );

  /** Navigate to the sessions management page */
  const handleBackToSessions = useCallback(() => {
    navigate(`/book/${book.id}/sessions`);
  }, [book.id, navigate]);

  // ---------------------------------------------------------------------------
  // Handle mode selection from BookSetupState skip-to-chat
  // ---------------------------------------------------------------------------

  const handleSelectMode = useCallback(
    () => {
      // Redirect to sessions page — the user can create a session there
      navigate(`/book/${book.id}/sessions`);
    },
    [book.id, navigate],
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
      // Only update tree + breadcrumb — don't touch messages/branches.
      // This avoids disrupting in-progress streaming conversations.
      setTree(state.tree);
      setBreadcrumb(state.breadcrumb);
    } catch (err) {
      console.error("Rename node failed:", err);
    }
  }, [userId, book.id, viewNodeId]);

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
  // On mount: load the session from URL, or redirect to sessions page
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (initialized.current) return;
    if (!userId) return;
    initialized.current = true;

    const initialSessionId = searchParams.get("session");
    const initialNodeId = searchParams.get("node") ?? null;
    const newSessionMode = searchParams.get("new"); // "reading" or "qa"
    lastViewNodeIdRef.current = initialNodeId;

    if (!initialSessionId) {
      // No session param — redirect to sessions page
      navigate(`/book/${book.id}/sessions`, { replace: true });
      return;
    }

    const sid = Number(initialSessionId);

    (async () => {
      setIsLoading(true);
      try {
        // Fetch sessions list (for session label in breadcrumb)
        const sessionsList = await fetchSessions(userId, book.id);
        setSessions(sessionsList);

        // Load the session
        setSessionId(sid);
        await loadSession(sid, initialNodeId);

        // If this is a newly created session (from SessionsPage), send the
        // initial mode-specific message
        if (newSessionMode) {
          sessionIdRef.current = sid;
          if (newSessionMode === "reading") {
            handleSendMessage(
              `Let's start reading "${book.title}" by ${book.author}. Give me a chapter briefing to begin.`,
            );
          } else if (newSessionMode === "qa") {
            handleSendMessage(
              `I'd like to explore "${book.title}" by ${book.author} through Q&A. I'll ask questions about the book — its themes, arguments, key passages, and ideas. Start by briefly introducing the book's main thesis in 2-3 sentences, then let me lead with questions.`,
            );
          }
        }
      } catch {
        // Session load failed — go to sessions page
        navigate(`/book/${book.id}/sessions`, { replace: true });
      }
    })();
  }, [userId, book, loadSession, searchParams, navigate, handleSendMessage]);

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
    messages,
    isLoading,
    isQueued,
    generatingNodeIds,
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
    handleDeleteSession,
    handleBackToSessions,
    handleSelectMode,
    handleDeleteNode,
    handleRenameNode,
    handleResetSession,
  };
}
