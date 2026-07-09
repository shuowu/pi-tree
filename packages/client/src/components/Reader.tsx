
import { useNavigate, useSearchParams } from "react-router";
import { useSource } from "./SourceLayout";
import { useUser } from "../UserContext";
import { useSourceProcessing } from "../hooks/useSourceProcessing";
import { usePanelLayout } from "../hooks/usePanelLayout";
import { useDictionary } from "../hooks/useDictionary";
import { useReaderSession } from "../hooks/useReaderSession";
import { ChatView, Breadcrumb, SelectionToolbar, type ModelInfo, type SlashCommand } from "@pi-tree/ui";
import { SourceSetupState } from "./SourceSetupState";
import { SourceSettingsModal } from "./SourceSettingsModal";
import { Sidebar } from "./Sidebar";
import { RightPanel } from "./RightPanel";
import { DictQuickCardStack } from "./DictionaryPanel";
import { SessionUsageBadge } from "./SessionUsageBadge";
import { NavMenu } from "./NavMenu";

import { fetchModels, updateSession, viewScope, createMemo, searchMemos, fetchMemos, enrichMemo, fetchHasAnalysis, summarizeBranch, exportSessionUrl } from "../api";
import { getBranchesCollapsed, getShowUsage, setShowUsage as saveShowUsage } from "../utils/preferences";
import { PanelLeft, PanelRight, Layers, Settings, Zap, StickyNote, Search, FileText } from "lucide-react";
import { getSourceTypeConfig } from "../source-types";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import "./Reader.css";

export function Reader() {
  const source = useSource();
  const navigate = useNavigate();
  const { userId } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showSettings, setShowSettings] = useState(false);
  const [showUsage, setShowUsage] = useState(() => getShowUsage());

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------

  const { currentSource, currentJob, handleProcessSource } =
    useSourceProcessing(source);

  const panel = usePanelLayout();

  const dict = useDictionary(
    userId,
    source.id,
  );

  // Toast — plain info toasts (memos) auto-dismiss quickly; toasts carrying a
  // nodeId are clickable and navigate to that node (e.g. "response ready in a
  // new branch" when auto-nav was suppressed because the user was reading).
  const [toast, setToast] = useState<{ message: string; nodeId?: string | null } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((next: { message: string; nodeId?: string | null }, durationMs: number) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(next);
    toastTimeoutRef.current = setTimeout(() => setToast(null), durationMs);
  }, []);
  const showMemoToast = useCallback((message: string) => {
    showToast({ message }, 2500);
  }, [showToast]);
  const notify = useCallback((message: string, nodeId: string | null) => {
    showToast({ message, nodeId }, 6000);
  }, [showToast]);

  const session = useReaderSession(userId, source, searchParams, setSearchParams, {
    isMobile: panel.isMobile,
    setSidebarOpen: panel.setSidebarOpen,
    setDictEntries: dict.setDictEntries,
    navigate,
    notify,
  });

  // Clear dictionary entries when session changes — dict is session-scoped
  useEffect(() => {
    dict.clearEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  // Model name and available models for the picker
  const [globalModel, setGlobalModel] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    fetchModels().then(({ models, currentModel }) => {
      setGlobalModel(currentModel);
      setAvailableModels(models);
    });
  }, []);

  // Effective model: session override wins over global default
  const modelName = session.sessionContext?.model ?? globalModel;

  const defaultBranchesCollapsed = useMemo(() => getBranchesCollapsed(), []);

  // Memo state
  const [memoCount, setMemoCount] = useState(0);

  // Fetch memo count for badge
  useEffect(() => {
    if (!userId) return;
    fetchMemos(userId, { sourceId: source.id }).then(all => setMemoCount(all.length)).catch(() => {});
  }, [userId, source.id]);

  // Detect when the AI's save_memo tool completes — refresh memos panel
  const prevStepsRef = useRef(session.completedSteps);
  useEffect(() => {
    const prev = prevStepsRef.current;
    prevStepsRef.current = session.completedSteps;
    // Look for newly completed save_memo steps
    if (session.completedSteps.length > prev.length) {
      const newSteps = session.completedSteps.slice(prev.length);
      if (newSteps.some(s => s.toolName === 'save_memo' && s.status === 'done')) {
        setMemoCount(c => c + 1);
        window.dispatchEvent(new Event('pi-tree:memos-changed'));
      }
    }
  }, [session.completedSteps]);

  // Analysis tab visibility — only show when the source has analysis files
  const [hasAnalysis, setHasAnalysis] = useState(false);
  useEffect(() => {
    fetchHasAnalysis(source.id).then(setHasAnalysis);
  }, [source.id]);

  // If the analysis tab is selected but no analysis exists, fall back
  useEffect(() => {
    if (!hasAnalysis && panel.rightTab === 'analysis') {
      panel.setRightTab('dict');
    }
  }, [hasAnalysis, panel.rightTab, panel]);

  // Slash commands
  const slashCommands = useMemo<SlashCommand[]>(() => [
    {
      name: 'memo',
      label: '/memo [text]',
      description: 'Save a memo from this conversation',
      icon: <StickyNote size={16} />,
    },
    {
      name: 'recall',
      label: '/recall <query>',
      description: 'Search your saved memos',
      icon: <Search size={16} />,
    },
    {
      name: 'summarize',
      label: '/summarize',
      description: 'Summarize this conversation and save as a memo',
      icon: <FileText size={16} />,
    },
  ], []);

  const handleSlashCommand = useCallback(async (
    command: string,
    args: string,
    context: { lastAssistantMessage?: string },
  ) => {
    if (!userId) return;

    if (command === 'memo') {
      const aiContent = context.lastAssistantMessage;
      const userNote = args?.trim() || undefined;

      // Build content: combine user note + AI response, or use whichever is available
      let content: string;
      if (userNote && aiContent) {
        content = `> ${userNote}\n\n${aiContent}`;
      } else if (aiContent) {
        content = aiContent;
      } else if (userNote) {
        content = userNote;
      } else {
        showMemoToast('Nothing to save — type /memo <text> or send a message first');
        return;
      }

      const title = content.slice(0, 60).replace(/\n/g, ' ') + (content.length > 60 ? '…' : '');
      try {
        const memo = await createMemo(userId, {
          title,
          content,
          sourceId: source.id,
          sessionId: session.sessionId ?? undefined,
          origin: 'command',
        });
        setMemoCount(c => c + 1);
        showMemoToast('Memo saved ✓');
        window.dispatchEvent(new Event('pi-tree:memos-changed'));

        // Background enrichment — fire and forget
        const topicPath = session.breadcrumb?.map(b => b.label).join(' > ') || undefined;
        enrichMemo(userId, memo.id, {
          sourceTitle: source.title,
          topicPath,
          userNote,
        }).then(() => {
          window.dispatchEvent(new Event('pi-tree:memos-changed'));
        }).catch(() => {});
      } catch (err) {
        console.error('Failed to save memo:', err);
        showMemoToast('Failed to save memo');
      }
    } else if (command === 'recall') {
      if (!args) {
        showMemoToast('Usage: /recall <search query>');
        return;
      }
      try {
        const results = await searchMemos(userId, args);
        if (results.length === 0) {
          showMemoToast('No memos found for "' + args + '"');
        } else {
          showMemoToast(`Found ${results.length} memo${results.length > 1 ? 's' : ''} — check Memos panel`);
          panel.setRightPanelOpen(true);
          panel.setRightTab('memos');
        }
      } catch (err) {
        console.error('Failed to search memos:', err);
        showMemoToast('Failed to search memos');
      }
    } else if (command === 'summarize') {
      // One-shot branch summarization — extracts only current branch messages
      // server-side and summarizes via ephemeral LLM call (no session pollution)
      if (!session.sessionId || !session.viewNodeId) {
        showMemoToast('No active session to summarize');
        return;
      }

      const breadcrumbLabels = session.breadcrumb?.map(b => b.label) ?? [];
      showMemoToast('Summarizing…');

      try {
        await summarizeBranch(
          userId,
          source.id,
          session.sessionId,
          session.viewNodeId,
          breadcrumbLabels,
          () => {}, // onToken — could wire to streaming display later
        );
        setMemoCount(c => c + 1);
        showMemoToast('Summary saved ✓');
        window.dispatchEvent(new Event('pi-tree:memos-changed'));
      } catch (err) {
        console.error('Failed to summarize branch:', err);
        showMemoToast('Failed to summarize');
      }
    }
  }, [userId, source.id, source.title, session.sessionId, session.viewNodeId, session.breadcrumb, showMemoToast, panel]);

  // Wrap SelectionToolbar as a render prop for the UI package's ChatView
  const renderSelectionToolbar = useCallback(
    (ctx: {
      containerRef: React.RefObject<HTMLDivElement | null>;
      onDefine: (term: string, context?: string) => void;
      onAsk: (text: string) => void;
      onBranch: (text: string) => void;
    }) => (
      <SelectionToolbar
        containerRef={ctx.containerRef}
        onDefine={ctx.onDefine}
        onAsk={ctx.onAsk}
        onBranch={ctx.onBranch}
        onSave={async (text, context) => {
          if (!userId) return;
          const title = text.slice(0, 60).replace(/\n/g, ' ') + (text.length > 60 ? '…' : '');
          try {
            const memo = await createMemo(userId, {
              title,
              content: context ? `> ${text}\n\n${context}` : text,
              sourceId: source.id,
              sessionId: session.sessionId ?? undefined,
              origin: 'selection',
            });
            setMemoCount(c => c + 1);
            showMemoToast('Memo saved ✓');
            window.dispatchEvent(new Event('pi-tree:memos-changed'));

            // Background enrichment — fire and forget
            const topicPath = session.breadcrumb?.map(b => b.label).join(' > ') || undefined;
            enrichMemo(userId, memo.id, {
              sourceTitle: source.title,
              topicPath,
            }).then(() => {
              window.dispatchEvent(new Event('pi-tree:memos-changed'));
            }).catch(() => {});
          } catch (err) {
            console.error('Failed to save memo:', err);
            showMemoToast('Failed to save memo');
          }
        }}
      />
    ),
    [userId, source.id, source.title, session.sessionId, session.breadcrumb, showMemoToast],
  );

  // Wrap viewScope for InlineBranches' fetchBranchPreview prop
  const fetchBranchPreview = useCallback(
    (uid: string, bid: string, sid: number, nodeId: string) =>
      viewScope(uid, bid, sid, nodeId),
    [],
  );



  const handleModelChange = useCallback(async (modelId: string) => {
    if (!userId || session.sessionId === null) return;
    const currentContext = session.sessionContext ?? { mode: 'reading' };
    const previousModel = currentContext.model;
    const newContext = { ...currentContext, model: modelId };
    // Optimistic update — show the new model immediately
    session.updateLocalSessionContext(newContext);
    try {
      await updateSession(userId, source.id, session.sessionId, {
        context: newContext,
      });
    } catch (err) {
      console.error('Failed to switch model:', err);
      // Rollback the optimistic update so UI stays in sync with server
      session.updateLocalSessionContext({ ...currentContext, model: previousModel });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, source.id, session.sessionId, session.sessionContext, session.updateLocalSessionContext]);

  const toggleUsage = useCallback(() => {
    setShowUsage(prev => {
      const next = !prev;
      saveShowUsage(next);
      return next;
    });
  }, []);

  const renderUsageBadge = useMemo(() => {
    if (!showUsage || session.sessionId === null) return undefined;
    const sid = session.sessionId;
    return () => <SessionUsageBadge sessionId={sid} />;
  }, [showUsage, session.sessionId]);

  const panelToggles = [
    { id: "sessions", icon: <Layers size={16} />, label: "Sessions", active: false, onClick: session.handleBackToSessions },
    { id: "nav", icon: <PanelLeft size={16} />, label: "Session Tree", active: panel.sidebarOpen, onClick: panel.toggleNavigator },
    { id: "right-panel", icon: <PanelRight size={16} />, label: "Right Panel", active: panel.rightPanelOpen, onClick: panel.toggleRightPanel },
    { id: "usage", icon: <Zap size={16} />, label: "Usage", active: showUsage, onClick: toggleUsage },
    { id: "settings", icon: <Settings size={16} />, label: "Settings", active: showSettings, onClick: () => setShowSettings(true) },
  ];

  // Determine what to show in the main area
  const sourceConfig = getSourceTypeConfig(source.type);
  const showBookSetup = sourceConfig.hasProcessing && (
    currentSource.status === "processing" ||
    currentSource.status === "pending" ||
    (currentSource.hasMarkdown && !currentSource.hasOutline && session.sessionId === null)
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className={`reader ${panel.sidebarOpen ? "sidebar-open" : ""} ${panel.rightPanelOpen ? "dict-open" : ""} ${panel.scrollDirection === "down" ? "scrolled-down" : ""}`}
      style={panel.cssVars}
      data-testid="reader"
    >
      {/* Mobile overlay backdrop */}
      <div
        className={`reader-overlay ${panel.sidebarOpen || panel.rightPanelOpen ? "visible" : ""}`}
        onClick={() => { panel.setSidebarOpen(false); panel.setRightPanelOpen(false); }}
      />
      <Sidebar
        sourceId={source.id}
        tree={session.tree}
        viewNodeId={session.viewNodeId}
        generatingNodeIds={session.generatingNodeIds}
        onNavigate={session.handleNavigate}
        onDeleteNode={session.handleDeleteNode}
        onRenameNode={session.handleRenameNode}
        onExportNode={(nodeId) => {
          if (!userId || session.sessionId === null) return;
          const a = document.createElement("a");
          a.href = exportSessionUrl(userId, source.id, session.sessionId, "html", nodeId);
          a.download = "";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }}
        isOpen={panel.sidebarOpen}
        onClose={() => panel.setSidebarOpen(false)}
      />
      {panel.sidebarOpen && (
        <div className="resize-handle" onMouseDown={panel.handleResizeStart} />
      )}
      <main className="reader-main">
        <Breadcrumb
          items={session.breadcrumb}
          onNavigate={session.handleNavigate}
          bookTitle={source.title}
          isScoped={session.viewNodeId !== null}
          panelToggles={panelToggles}
          sessionLabel={session.sessionLabel}
          leftSlot={<NavMenu />}
        />
        {showBookSetup ? (
          <SourceSetupState
            source={currentSource}
            job={currentJob}
            onSkipToChat={() => session.handleSelectMode()}
            onProcess={handleProcessSource}
          />
        ) : session.sessionId !== null ? (
          <>
            <ChatView
              messages={session.messages}
              isLoading={session.isLoading}
              isCompacting={session.isCompacting}
              isQueued={session.isQueued}
              streamingContent={session.streamingContent}
              activeToolCall={session.activeToolCall}
              onSendMessage={session.handleSendMessage}
              branches={session.branches}
              onDrillDown={session.handleNavigate}
              isScoped={session.viewNodeId !== null}
              bookId={source.id}
              sessionId={session.sessionId}
              userId={userId!}
              onDefine={dict.handleDefine}
              onScrollDirectionChange={panel.setScrollDirection}
              onFollowChange={session.handleFollowChange}
              scrollTopTrigger={session.scrollTopTrigger}
              modelName={modelName}
              renderSelectionToolbar={renderSelectionToolbar}
              defaultBranchesCollapsed={defaultBranchesCollapsed}
              fetchBranchPreview={fetchBranchPreview}
              placeholderText={getSourceTypeConfig(source.type).chatPlaceholder}
              welcomeMessage={session.profileDescription}
              availableModels={availableModels}
              onModelChange={handleModelChange}
              onFork={session.handleFork}
              onStop={session.handleStopGeneration}
              parentContext={session.parentContext}
              renderAboveInput={renderUsageBadge}
              completedSteps={session.completedSteps}
              slashCommands={slashCommands}
              onSlashCommand={handleSlashCommand}
            />
          </>
        ) : null}
      </main>

      <RightPanel
        isOpen={panel.rightPanelOpen}
        rightTab={panel.rightTab}
        onTabChange={panel.setRightTab}
        onClose={() => panel.setRightPanelOpen(false)}
        dictEntries={dict.dictEntries}
        onDictRemove={dict.handleDictRemove}
        sourceId={source.id}
        sourceType={source.type}
        onDefine={dict.handleDefine}
        onDismissQuickLookup={dict.dismissAllQuickCards}
        onResizeStart={panel.handleRightResizeStart}
        onSendMessage={session.handleSendMessage}
        userId={userId!}
        sessionId={session.sessionId ?? undefined}
        memoCount={memoCount}
        hasAnalysis={hasAnalysis}
      />

      {/* Floating dictionary quick card stack — hidden when the right panel
          is open on the dict tab (no need for both simultaneously) */}
      {!(panel.rightPanelOpen && panel.rightTab === "dict") && <DictQuickCardStack
        entries={dict.quickLookupStack
          .map((id) => dict.dictEntries.find((e) => e.id === id))
          .filter((e): e is NonNullable<typeof e> => !!e)}
        onDismiss={dict.dismissQuickCard}
        onGoToDict={() => {
          panel.setRightPanelOpen(true);
          panel.setRightTab("dict");
          dict.dismissAllQuickCards();
        }}
      />}

      {showSettings && (
        <SourceSettingsModal
          source={currentSource}
          onClose={() => setShowSettings(false)}
        />
      )}

      {toast && (
        toast.nodeId !== undefined ? (
          <button
            className="memo-toast memo-toast--action"
            onClick={() => {
              if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
              setToast(null);
              session.handleNavigate(toast.nodeId ?? "");
            }}
          >
            {toast.message}
            <span className="memo-toast-view">View →</span>
          </button>
        ) : (
          <div className="memo-toast">{toast.message}</div>
        )
      )}

    </div>
  );
}
