import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatMessage,
  BreadcrumbItem,
  TreeNodeView,
  BranchOption,
} from "@pi-tree/core/types";
import type {
  Source,
  SourceSession,
} from "@pi-tree/shared";
import {
  startSession,
  resetSession,
  viewScope,
  forkAtNode,
  fetchGlossary,
  deleteNode,
  renameNode,
  fetchSessions,
  fetchProfiles,
  deleteSession as deleteSessionApi,
} from "../api";
import type { DictEntry } from "../components/DictionaryPanel";
import { useStream } from "../StreamContext";
import { resolveSendContext, shouldApplyStreamResult } from "./send-context";

interface UseReaderSessionDeps {
  isMobile: () => boolean;
  setSidebarOpen: (open: boolean) => void;
  setDictEntries: React.Dispatch<React.SetStateAction<DictEntry[]>>;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}
export function useReaderSession(
  userId: string | null,
  source: Source,
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
  const [sessions, setSessions] = useState<SourceSession[]>([]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [tree, setTree] = useState<TreeNodeView | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [parentContext, setParentContext] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [isQueued, setIsQueued] = useState(false);
  const [activeToolCall, setActiveToolCall] = useState<{ toolName: string; args: Record<string, unknown> } | null>(null);
  // Track which tree nodes have in-flight AI responses (for tree spinner)
  const [generatingNodeIds, setGeneratingNodeIds] = useState<Set<string>>(new Set());
  // Counter incremented on explicit navigation (not streaming completion).
  // ChatView watches this to scroll-to-top only on navigation.
  const [scrollTopTrigger, setScrollTopTrigger] = useState(0);
  const [profileDescription, setProfileDescription] = useState<string | null>(null);

  const initialized = useRef(false);
  // Track the last viewNodeId we set programmatically, so we can detect
  // browser-initiated changes (back/forward) vs our own updates.
  const lastViewNodeIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<number | null>(sessionId);

  const { streams, startMessageStream, clearStream, stopStream } = useStream();

  // Fork scope — set by handleFork, consumed by the next handleSendMessage.
  // When set, the next message is routed to the fork scope (parent level)
  // instead of the current viewNodeId, so branching happens at the right level.
  const pendingForkScopeRef = useRef<string | null>(null);



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
          next.delete("query");
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
      parentContext?: ChatMessage[];
    }) => {
      setMessages(state.messages);
      setBreadcrumb(state.breadcrumb);
      setTree(state.tree);
      setBranches(state.branches);
      setParentContext(state.parentContext ?? []);
    },
    [],
  );

  // Reactive effect to sync global streaming state into the component
  useEffect(() => {
    const key = `${source.id}:${sessionId}`;
    const activeStream = streams[key];

    if (!activeStream) return;

    const sendingNodeId = activeStream.sendingNodeId;

    if (activeStream.status === "streaming") {
      if (shouldApplyStreamResult(lastViewNodeIdRef.current, sendingNodeId)) {
        setStreamingContent(activeStream.accumulatedText);
        setIsQueued(activeStream.isQueued);
        setActiveToolCall(activeStream.activeToolCall);
        setIsCompacting(activeStream.isCompacting);
        setIsLoading(true);
      } else {
        setStreamingContent(null);
        setIsQueued(false);
        setActiveToolCall(null);
        setIsCompacting(false);
      }
    } else if (activeStream.status === "done") {
      if (sendingNodeId) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setGeneratingNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(sendingNodeId);
          return next;
        });
      }
      if (shouldApplyStreamResult(lastViewNodeIdRef.current, sendingNodeId)) {
        setStreamingContent(null);
        setIsLoading(false);
        setIsCompacting(false);
        setIsQueued(false);
        setActiveToolCall(null);
        if (activeStream.result) {
          applySessionData(activeStream.result);
          updateUrl(activeStream.result.viewNodeId, sessionId, true);
        } else if (activeStream.accumulatedText?.trim()) {
          // Abort / stop: no server result, but we have locally accumulated text.
          // Keep it as a regular message so the partial response isn't lost.
          const stoppedMsg: ChatMessage = {
            id: `stopped-${Date.now()}`,
            role: "assistant",
            content: activeStream.accumulatedText,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, stoppedMsg]);
        }
      }
      clearStream(source.id, sessionId!);
    } else if (activeStream.status === "error") {
      if (sendingNodeId) {
        setGeneratingNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(sendingNodeId);
          return next;
        });
      }
      if (shouldApplyStreamResult(lastViewNodeIdRef.current, sendingNodeId)) {
        setStreamingContent(null);
        setIsLoading(false);
        setIsCompacting(false);
        setIsQueued(false);
        setActiveToolCall(null);
        if (activeStream.error) {
          const errorMsg: ChatMessage = {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `⚠️ Error: ${activeStream.error.message}`,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMsg]);
        }
      }
      clearStream(source.id, sessionId!);
    }
  }, [streams, viewNodeId, source.id, sessionId, userId, applySessionData, updateUrl, clearStream]);

  const handleSendMessage = useCallback(
    async (message: string) => {
      if (!userId) return;
      const sid = sessionIdRef.current;
      if (sid === null) return;

      // Use fork scope if set (routes message to the fork level, not the viewed scope)
      const forkScope = pendingForkScopeRef.current;
      pendingForkScopeRef.current = null;

      const { sendingNodeId, forceBranch, nextLastViewNodeId } =
        resolveSendContext(forkScope, lastViewNodeIdRef.current);
      lastViewNodeIdRef.current = nextLastViewNodeId;


      // Track which node is generating (for tree panel spinner).
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

      startMessageStream(userId, source.id, sid, message, sendingNodeId, (updatedTree) => {
        setTree(updatedTree);
      }, forceBranch ? { forceBranch: true } : undefined).catch((err) => {
        console.error("Stream start failed:", err);
      });
    },
    [userId, source.id, startMessageStream],
  );

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const handleNavigate = useCallback(
    async (nodeId: string) => {
      if (!userId) return;
      const sid = sessionIdRef.current;
      if (sid === null) return;

      setStreamingContent(null);
      setIsCompacting(false);
      setIsQueued(false);
      setActiveToolCall(null);

      // Navigation cancels any pending fork — if the user forked but then
      // navigated elsewhere, the fork scope is stale and shouldn't affect
      // the next message.
      pendingForkScopeRef.current = null;

      // Auto-close sidebar on mobile after navigating
      if (isMobile()) {
        setSidebarOpen(false);
      }

      setIsLoading(true);
      try {
        // Pass nodeId as-is: "" means "explicit root" (no server auto-resolve),
        // a real ID scopes into that node.
        const state = await viewScope(userId, source.id, sid, nodeId || "");
        applySessionData(state);
        updateUrl(state.viewNodeId, sid, false); // push history entry
        setScrollTopTrigger((c) => c + 1);
      } catch (err) {
        console.error("Navigate failed:", err);
      } finally {
        const targetId = nodeId || null;
        const activeStream = streams[`${source.id}:${sid}`];
        const isRestoring = activeStream && activeStream.sendingNodeId === targetId && activeStream.status === "streaming";
        if (!isRestoring) {
          setIsLoading(false);
        }
      }
    },
    [userId, source.id, applySessionData, updateUrl, isMobile, setSidebarOpen, streams],
  );

  const handleBackToRoot = useCallback(async () => {
    if (!userId) return;
    const sid = sessionIdRef.current;
    if (sid === null) return;

    // Back-to-root cancels any pending fork — same as handleNavigate.
    pendingForkScopeRef.current = null;

    setIsLoading(true);
    try {
      const state = await viewScope(userId, source.id, sid, "");
      applySessionData(state);
      updateUrl(state.viewNodeId, sid, false); // push history entry
      setScrollTopTrigger((c) => c + 1);
    } catch (err) {
      console.error("Back to root failed:", err);
    } finally {
      const activeStream = streams[`${source.id}:null`] || streams[`${source.id}:${sid}`];
      const isRestoring = activeStream && activeStream.sendingNodeId === null && activeStream.status === "streaming";
      if (!isRestoring) {
        setIsLoading(false);
      }
    }
  }, [userId, source.id, applySessionData, updateUrl, streams]);

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
        const state = await startSession(userId, source.id, sid);

        // Load persisted glossary entries from DB
        try {
          const saved = await fetchGlossary(userId, source.id);
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
              const scopedState = await viewScope(userId, source.id, sid, initialNodeId);
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
            setScrollTopTrigger((c) => c + 1);
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
    [userId, source.id, applySessionData, updateUrl, setDictEntries],
  );

  // ---------------------------------------------------------------------------
  // Session actions available from within the Reader
  // ---------------------------------------------------------------------------

  /** Delete a session (e.g. from settings modal) */
  const handleDeleteSession = useCallback(
    async (sid: number) => {
      if (!userId) return;
      try {
        await deleteSessionApi(userId, source.id, sid);

        // If we deleted the active session, navigate to sessions page
        if (sessionId === sid) {
          setSessionId(null);
          setMessages([]);
          setTree(null);
          setBreadcrumb([]);
          setBranches([]);
          navigate(`/source/${source.id}/sessions`, { replace: true });
        }
      } catch (err) {
        console.error("Delete session failed:", err);
      }
    },
    [userId, source.id, sessionId, navigate],
  );

  /** Navigate to the sessions management page */
  const handleBackToSessions = useCallback(() => {
    navigate(`/source/${source.id}/sessions`);
  }, [source.id, navigate]);

  // ---------------------------------------------------------------------------
  // Handle mode selection from SourceSetupState skip-to-chat
  // ---------------------------------------------------------------------------

  const handleSelectMode = useCallback(
    () => {
      // Redirect to sessions page — the user can create a session there
      navigate(`/source/${source.id}/sessions`);
    },
    [source.id, navigate],
  );

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (!userId) return;
    const sid = sessionIdRef.current;
    if (sid === null) return;
    try {
      const state = await deleteNode(userId, source.id, sid, nodeId, viewNodeId);
      applySessionData(state);
      updateUrl(state.viewNodeId, sid, true);
    } catch (err) {
      console.error("Delete node failed:", err);
    }
  }, [userId, source.id, viewNodeId, applySessionData, updateUrl]);

  const handleRenameNode = useCallback(async (nodeId: string, newLabel: string) => {
    if (!userId) return;
    const sid = sessionIdRef.current;
    if (sid === null) return;
    try {
      const state = await renameNode(userId, source.id, sid, nodeId, newLabel, viewNodeId);
      // Only update tree + breadcrumb — don't touch messages/branches.
      // This avoids disrupting in-progress streaming conversations.
      setTree(state.tree);
      setBreadcrumb(state.breadcrumb);
    } catch (err) {
      console.error("Rename node failed:", err);
    }
  }, [userId, source.id, viewNodeId]);

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
      await resetSession(userId, source.id, sid);
      // Full reload to get a clean slate
      window.location.href = `/source/${source.id}?session=${sid}`;
    } catch (err) {
      console.error("Reset failed:", err);
    }
  }, [userId, source.id, handleBackToSessions]);

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
    const initialQuery = searchParams.get("query"); // custom query
    lastViewNodeIdRef.current = initialNodeId;

    if (!initialSessionId) {
      // No session param — redirect to sessions page
      navigate(`/source/${source.id}/sessions`, { replace: true });
      return;
    }

    const sid = Number(initialSessionId);

    (async () => {
      setIsLoading(true);
      try {
        // Fetch sessions list (for session label in breadcrumb)
        const { sessions: sessionsList } = await fetchSessions(userId, { source: source.id });
        setSessions(sessionsList);

        // Load the session
        setSessionId(sid);
        await loadSession(sid, initialNodeId);

        // If this is a newly created session, optionally send an initial message
        if (initialQuery) {
          // Explicit query from URL (e.g. router redirect with ?query=...)
          sessionIdRef.current = sid;
          handleSendMessage(initialQuery);
        } else if (newSessionMode) {
          // New session via mode — only auto-send if the profile has a defaultPrompt.
          // If no defaultPrompt, the session starts empty and the user types first.
          sessionIdRef.current = sid;
          try {
            const profileMap = await fetchProfiles();
            const profileKey = `${source.type}.${newSessionMode}`;
            const profile = profileMap[profileKey] || profileMap[newSessionMode];
            if (profile?.description) {
              setProfileDescription(profile.description);
            }
            const defaultPrompt = profile?.defaultPrompt
              ?.replace(/\{sourceTitle\}/g, source.title)
              ?.replace(/\{sourceAuthor\}/g, source.author || '');
            if (defaultPrompt) {
              handleSendMessage(defaultPrompt);
            }
          } catch {
            // No auto-message on error — user can type their own
          }
        }
      } catch (err) {
        // Session load failed — log for observability, then redirect to sessions page
        console.error("[useReaderSession] Session load failed, redirecting to sessions page:", err);
        navigate(`/source/${source.id}/sessions`, { replace: true });
      }
    })();
  }, [userId, source, loadSession, searchParams, navigate, handleSendMessage]);

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
        const state = await viewScope(userId, source.id, sid, viewNodeId);
        applySessionData(state);
        setScrollTopTrigger((c) => c + 1);
      } catch (err) {
        console.error("Browser nav restore failed:", err);
      } finally {
        const activeStream = streams[`${source.id}:${sid}`];
        const isRestoring = activeStream && activeStream.sendingNodeId === viewNodeId && activeStream.status === "streaming";
        if (!isRestoring) {
          setIsLoading(false);
        }
      }
    })();
  }, [viewNodeId, userId, source.id, applySessionData, streams]);

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

  const sessionContext = activeSession?.context ?? null;

  /** Update the local session context (e.g. after model switch) without refetching. */
  const updateLocalSessionContext = useCallback(
    (newContext: import("@pi-tree/shared").SessionContext) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, context: newContext } : s,
        ),
      );
    },
    [sessionId],
  );

  return {
    sessionId,
    messages,
    isLoading,
    isQueued,
    generatingNodeIds,
    breadcrumb,
    tree,
    branches,
    parentContext,
    streamingContent,
    isCompacting,
    activeToolCall,
    viewNodeId,
    sessionLabel,
    sessionContext,
    scrollTopTrigger,
    profileDescription,
    handleSendMessage,
    handleStopGeneration: useCallback(() => {
      const sid = sessionIdRef.current;
      if (sid === null) return;
      stopStream(source.id, sid);
    }, [source.id, stopStream]),
    handleNavigate,
    handleBackToRoot,
    handleDeleteSession,
    handleBackToSessions,
    handleSelectMode,
    handleDeleteNode,
    handleRenameNode,
    handleResetSession,
    updateLocalSessionContext,
    handleFork: useCallback(
      async (nodeId: string) => {
        if (!userId) return;
        const sid = sessionIdRef.current;
        if (sid === null) return;

        setIsLoading(true);
        try {
          // Immediately fork on the server (moves SDK pointer)
          const { state, forkScopeId } = await forkAtNode(userId, source.id, sid, nodeId);
          applySessionData(state);
          updateUrl(state.viewNodeId, sid, false);
          setScrollTopTrigger((c) => c + 1);
          // Store the fork scope so the next message routes to the correct level
          pendingForkScopeRef.current = forkScopeId;
        } catch (err) {
          console.error("Fork failed:", err);
        } finally {
          setIsLoading(false);
        }
      },
      [userId, source.id, applySessionData, updateUrl],
    ),
  };
}
