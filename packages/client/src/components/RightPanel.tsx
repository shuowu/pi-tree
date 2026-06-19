import type { DictEntry } from "./DictionaryPanel";
import { DictionaryPanel, DictQuickCard } from "./DictionaryPanel";
import { getSourceTypeConfig } from "../source-types";
import { X } from "lucide-react";

interface RightPanelProps {
  isOpen: boolean;
  rightTab: "dict" | "content";
  onTabChange: (tab: "dict" | "content") => void;
  onClose: () => void;
  dictEntries: DictEntry[];
  onDictRemove: (id: string) => void;
  sourceId: string;
  sourceType?: string;
  onDefine: (term: string, context?: string) => void;
  quickLookupId: string | null;
  onDismissQuickLookup: () => void;
  onGoToDict: () => void;
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
  quickLookupId,
  onDismissQuickLookup,
  onGoToDict,
  onResizeStart,
  onSendMessage,
}: RightPanelProps) {
  const config = getSourceTypeConfig(sourceType ?? "book");
  const PanelComponent = config.contentPanel;

  return (
    <>
      {/* Right sidebar: always rendered, hidden via CSS to preserve nav state */}
      <div className={`resize-handle-right ${isOpen ? "" : "hidden"}`} onMouseDown={onResizeStart} />
      <aside className={`right-sidebar ${isOpen ? "" : "hidden"}`}>
        <div className="right-sidebar-header">
          <div className="right-sidebar-tabs">
            <button
              className={`right-sidebar-tab ${rightTab === "dict" ? "active" : ""}`}
              onClick={() => { onTabChange("dict"); onDismissQuickLookup(); }}
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
              >
                {config.label}
              </button>
            )}
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
              {quickLookupId && (() => {
                const entry = dictEntries.find((e) => e.id === quickLookupId);
                if (!entry) return null;
                return (
                  <DictQuickCard
                    entry={entry}
                    onDismiss={onDismissQuickLookup}
                    onGoToDict={onGoToDict}
                  />
                );
              })()}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
