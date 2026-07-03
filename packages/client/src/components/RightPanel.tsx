import type { DictEntry } from "./DictionaryPanel";
import { DictionaryPanel } from "./DictionaryPanel";
import { AnalysisPanel } from "./AnalysisPanel";
import { MemosPanel } from "./MemosPanel";
import { getSourceTypeConfig } from "../source-types";
import { X, StickyNote } from "lucide-react";

interface RightPanelProps {
  isOpen: boolean;
  rightTab: "dict" | "content" | "analysis" | "memos";
  onTabChange: (tab: "dict" | "content" | "analysis" | "memos") => void;
  onClose: () => void;
  dictEntries: DictEntry[];
  onDictRemove: (id: string) => void;
  sourceId: string;
  sourceType?: string;
  onDefine: (term: string, context?: string) => void;
  onDismissQuickLookup: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onSendMessage?: (message: string) => void;
  userId: string;
  sessionId?: number;
  memoCount?: number;
  /** Whether this source has analysis files; hides the tab when false */
  hasAnalysis?: boolean;
}

export function RightPanel({
  isOpen,
  rightTab,
  onTabChange,
  onClose,
  dictEntries,
  onDictRemove,
  sourceId,
  sourceType,
  onDefine,
  onDismissQuickLookup,
  onResizeStart,
  onSendMessage,
  userId,
  sessionId,
  memoCount,
  hasAnalysis,
}: RightPanelProps) {
  const config = getSourceTypeConfig(sourceType ?? "");
  const PanelComponent = config.contentPanel;

  return (
    <>
      {/* Right sidebar: always rendered, hidden via CSS to preserve nav state */}
      <div className={`resize-handle-right ${isOpen ? "" : "hidden"}`} onMouseDown={onResizeStart} />
      <aside className={`right-sidebar ${isOpen ? "" : "hidden"}`} data-testid="right-panel">
        <div className="right-sidebar-header">
          <div className="right-sidebar-tabs">
            <button
              className={`right-sidebar-tab ${rightTab === "dict" ? "active" : ""}`}
              onClick={() => { onTabChange("dict"); onDismissQuickLookup(); }}
              data-testid="right-tab-dict"
            >
              Dictionary
              {dictEntries.length > 0 && (
                <span className="right-sidebar-count">{dictEntries.length}</span>
              )}
            </button>
            {PanelComponent && (
              <button
                className={`right-sidebar-tab ${rightTab === "content" ? "active" : ""}`}
                onClick={() => onTabChange("content")}
                data-testid="right-tab-content"
              >
                {config.label}
              </button>
            )}
            {hasAnalysis && (
              <button
                className={`right-sidebar-tab ${rightTab === "analysis" ? "active" : ""}`}
                onClick={() => onTabChange("analysis")}
                data-testid="right-tab-analysis"
              >
                Analysis
              </button>
            )}
            <button
              className={`right-sidebar-tab ${rightTab === "memos" ? "active" : ""}`}
              onClick={() => onTabChange("memos")}
              data-testid="right-tab-memos"
            >
              <StickyNote size={12} style={{ marginRight: 4 }} />
              Memos
              {(memoCount ?? 0) > 0 && (
                <span className="right-sidebar-count">{memoCount}</span>
              )}
            </button>
          </div>
          <button
            className="right-sidebar-close"
            onClick={onClose}
            title="Close panel"
          >
            <X size={14} />
          </button>
        </div>
        <div className="right-sidebar-body">
          <div style={{ display: rightTab === "dict" ? "contents" : "none" }}>
            <DictionaryPanel entries={dictEntries} onRemove={onDictRemove} />
          </div>
          {PanelComponent && (
            <div style={{ display: rightTab === "content" ? "contents" : "none" }}>
              <PanelComponent
                sourceId={sourceId}
                onDefine={onDefine}
                onSendMessage={onSendMessage}
              />
            </div>
          )}
          {hasAnalysis && (
            <div style={{ display: rightTab === "analysis" ? "contents" : "none" }}>
              <AnalysisPanel sourceId={sourceId} />
            </div>
          )}
          <div style={{ display: rightTab === "memos" ? "contents" : "none" }}>
            <MemosPanel sourceId={sourceId} userId={userId} sessionId={sessionId} />
          </div>
        </div>
      </aside>
    </>
  );
}
