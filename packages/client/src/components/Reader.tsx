import { useNavigate, useSearchParams } from "react-router";
import { useSource } from "./BookLayout";
import { useUser } from "../UserContext";
import { useSourceProcessing } from "../hooks/useBookProcessing";
import { usePanelLayout } from "../hooks/usePanelLayout";
import { useDictionary } from "../hooks/useDictionary";
import { useReaderSession } from "../hooks/useReaderSession";
import { ChatView, Breadcrumb, type ModelInfo } from "@pi-tree/ui";
import { SelectionToolbar } from "./SelectionToolbar";
import { BookSetupState } from "./BookSetupState";
import { Sidebar } from "./Sidebar";
import { RightPanel } from "./RightPanel";
import { BookSettingsModal } from "./BookSettingsModal";
import { fetchModels, updateSession, viewScope } from "../api";
import { getBranchesCollapsed } from "../utils/preferences";
import { PanelLeft, PanelRight, Home, Settings, Layers } from "lucide-react";
import { getSourceTypeConfig } from "../source-types";
import { useState, useEffect, useMemo, useCallback } from "react";
import "./Reader.css";

export function Reader() {
  const source = useSource();
  const navigate = useNavigate();
  const { userId } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------

  const { currentSource, currentJob, handleProcessSource, handleReprocessSource } =
    useSourceProcessing(source);

  const panel = usePanelLayout();

  const dict = useDictionary(
    userId,
    source.id,
    panel.rightTab,
    panel.setRightPanelOpen,
    panel.setRightTab,
  );

  const session = useReaderSession(userId, source, searchParams, setSearchParams, {
    isMobile: panel.isMobile,
    setSidebarOpen: panel.setSidebarOpen,
    setDictEntries: dict.setDictEntries,
    navigate,
  });

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

  // Wrap SelectionToolbar as a render prop for the UI package's ChatView
  const renderSelectionToolbar = useCallback(
    (ctx: {
      containerRef: React.RefObject<HTMLDivElement | null>;
      onDefine: (term: string, context?: string) => void;
      onAsk: (text: string) => void;
    }) => (
      <SelectionToolbar
        containerRef={ctx.containerRef}
        onDefine={ctx.onDefine}
        onAsk={ctx.onAsk}
      />
    ),
    [],
  );

  // Wrap viewScope for InlineBranches' fetchBranchPreview prop
  const fetchBranchPreview = useCallback(
    (uid: string, bid: string, sid: number, nodeId: string) =>
      viewScope(uid, bid, sid, nodeId),
    [],
  );

  const goBack = () => navigate("/");

  const handleModelChange = useCallback(async (modelId: string) => {
    if (!userId || session.sessionId === null) return;
    const currentContext = session.sessionContext ?? { mode: 'reading' };
    const newContext = { ...currentContext, model: modelId };
    try {
      await updateSession(userId, source.id, session.sessionId, {
        context: newContext,
      });
      // Update local state so the badge reflects the new model immediately.
      // The server evicts the cached session on context change, so the next
      // message will automatically use the new model.
      session.updateLocalSessionContext(newContext);
    } catch (err) {
      console.error('Failed to switch model:', err);
    }
  }, [userId, source.id, session.sessionId, session.sessionContext, session.updateLocalSessionContext]);

  const panelToggles = [
    { id: "home", icon: <Home size={16} />, label: "Library", active: false, onClick: goBack },
    { id: "sessions", icon: <Layers size={16} />, label: "Sessions", active: false, onClick: session.handleBackToSessions },
    { id: "nav", icon: <PanelLeft size={16} />, label: "Session Tree", active: panel.sidebarOpen, onClick: panel.toggleNavigator },
    { id: "dict", icon: <PanelRight size={16} />, label: "Dictionary", active: panel.rightPanelOpen && panel.rightTab === "dict", onClick: panel.toggleDict },
    { id: "settings", icon: <Settings size={16} />, label: "Source Settings", active: panel.showBookSettings, onClick: () => panel.setShowBookSettings(true) },
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
        />
        {showBookSetup ? (
          <BookSetupState
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
              scrollTopTrigger={session.scrollTopTrigger}
              modelName={modelName}
              renderSelectionToolbar={renderSelectionToolbar}
              defaultBranchesCollapsed={defaultBranchesCollapsed}
              fetchBranchPreview={fetchBranchPreview}
              placeholderText={getSourceTypeConfig(source.type).chatPlaceholder}
              availableModels={availableModels}
              onModelChange={handleModelChange}
              onFork={session.handleFork}
              parentContext={session.parentContext}
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
        quickLookupId={dict.quickLookupId}
        onDismissQuickLookup={() => dict.setQuickLookupId(null)}
        onGoToDict={() => { panel.setRightTab("dict"); dict.setQuickLookupId(null); }}
        onResizeStart={panel.handleRightResizeStart}
        onSendMessage={session.handleSendMessage}
      />

      {panel.showBookSettings && (
        <BookSettingsModal
          source={currentSource}
          onClose={() => panel.setShowBookSettings(false)}
          onReprocess={handleReprocessSource}
          onClearSession={session.handleResetSession}
          sessionLabel={session.sessionLabel}
        />
      )}
    </div>
  );
}
