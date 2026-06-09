import { useNavigate, useSearchParams } from "react-router";
import { useBook } from "./BookLayout";
import { useUser } from "../UserContext";
import { useBookProcessing } from "../hooks/useBookProcessing";
import { usePanelLayout } from "../hooks/usePanelLayout";
import { useDictionary } from "../hooks/useDictionary";
import { useReaderSession } from "../hooks/useReaderSession";
import { ChatView, Breadcrumb } from "@pi-tree/ui";
import { SelectionToolbar } from "./SelectionToolbar";
import { BookSetupState } from "./BookSetupState";
import { Sidebar } from "./Sidebar";
import { RightPanel } from "./RightPanel";
import { BookSettingsModal } from "./BookSettingsModal";
import { fetchServerConfig, viewScope } from "../api";
import { getBranchesCollapsed } from "../utils/preferences";
import { PanelLeft, PanelRight, Home, Settings, Layers } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import "./Reader.css";

export function Reader() {
  const book = useBook();
  const navigate = useNavigate();
  const { userId } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------

  const { currentBook, currentJob, handleProcessBook, handleReprocessBook } =
    useBookProcessing(book);

  const panel = usePanelLayout();

  const dict = useDictionary(
    userId,
    book.id,
    panel.rightTab,
    panel.setRightPanelOpen,
    panel.setRightTab,
  );

  const session = useReaderSession(userId, book, searchParams, setSearchParams, {
    isMobile: panel.isMobile,
    setSidebarOpen: panel.setSidebarOpen,
    setDictEntries: dict.setDictEntries,
    navigate,
  });

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  // Model name for display badge
  const [modelName, setModelName] = useState<string | null>(null);
  useEffect(() => {
    fetchServerConfig().then((cfg) => setModelName(cfg.readingModel));
  }, []);

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

  const panelToggles = [
    { id: "home", icon: <Home size={16} />, label: "Library", active: false, onClick: goBack },
    { id: "sessions", icon: <Layers size={16} />, label: "Sessions", active: false, onClick: session.handleBackToSessions },
    { id: "nav", icon: <PanelLeft size={16} />, label: "Session Tree", active: panel.sidebarOpen, onClick: panel.toggleNavigator },
    { id: "dict", icon: <PanelRight size={16} />, label: "Dictionary", active: panel.rightPanelOpen && panel.rightTab === "dict", onClick: panel.toggleDict },
    { id: "settings", icon: <Settings size={16} />, label: "Book Settings", active: panel.showBookSettings, onClick: () => panel.setShowBookSettings(true) },
  ];

  // Determine what to show in the main area
  const showBookSetup =
    currentBook.status === "processing" ||
    currentBook.status === "pending" ||
    (currentBook.hasMarkdown && !currentBook.hasOutline && session.sessionId === null);

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
        bookId={book.id}
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
          bookTitle={book.title}
          isScoped={session.viewNodeId !== null}
          panelToggles={panelToggles}
          sessionLabel={session.sessionLabel}
        />
        {showBookSetup ? (
          <BookSetupState
            book={currentBook}
            job={currentJob}
            onSkipToChat={() => session.handleSelectMode()}
            onProcess={handleProcessBook}
          />
        ) : session.sessionId !== null ? (
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
            bookId={book.id}
            sessionId={session.sessionId}
            userId={userId!}
            onDefine={dict.handleDefine}
            onScrollDirectionChange={panel.setScrollDirection}
            scrollTopTrigger={session.scrollTopTrigger}
            modelName={modelName}
            renderSelectionToolbar={renderSelectionToolbar}
            defaultBranchesCollapsed={defaultBranchesCollapsed}
            fetchBranchPreview={fetchBranchPreview}
          />
        ) : null}
      </main>

      <RightPanel
        isOpen={panel.rightPanelOpen}
        rightTab={panel.rightTab}
        onTabChange={panel.setRightTab}
        onClose={() => panel.setRightPanelOpen(false)}
        dictEntries={dict.dictEntries}
        onDictRemove={dict.handleDictRemove}
        bookId={book.id}
        onDefine={dict.handleDefine}
        quickLookupId={dict.quickLookupId}
        onDismissQuickLookup={() => dict.setQuickLookupId(null)}
        onGoToDict={() => { panel.setRightTab("dict"); dict.setQuickLookupId(null); }}
        onResizeStart={panel.handleRightResizeStart}
      />

      {panel.showBookSettings && (
        <BookSettingsModal
          book={currentBook}
          onClose={() => panel.setShowBookSettings(false)}
          onReprocess={handleReprocessBook}
          onClearSession={session.handleResetSession}
          sessionLabel={session.sessionLabel}
        />
      )}
    </div>
  );
}
