import type { DictEntry } from "./DictionaryPanel";
import { DictionaryPanel } from "./DictionaryPanel";
import { AnalysisPanel } from "./AnalysisPanel";
import { getSourceTypeConfig } from "../source-types";
import { X } from "lucide-react";

interface RightPanelProps {
  isOpen: boolean;
  rightTab: "dict" | "content" | "analysis";
  onTabChange: (tab: "dict" | "content" | "analysis") => void;
  onClose: () => void;
  dictEntries: DictEntry[];
  onDictRemove: (id: string) => void;
  sourceId: string;
  sourceType?: string;
  onDefine: (term: string, context?: string) => void;
  onDismissQuickLookup: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onSendMessage?: (message: string) => void;
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
            <button
              className={`right-sidebar-tab ${rightTab === "analysis" ? "active" : ""}`}
              onClick={() => onTabChange("analysis")}
              data-testid="right-tab-analysis"
            >
              Analysis
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
          <div style={{ display: rightTab === "analysis" ? "contents" : "none" }}>
            <AnalysisPanel sourceId={sourceId} />
          </div>
        </div>
      </aside>
    </>
  );
}
