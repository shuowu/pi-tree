/**
 * Read-only session viewer — the UI of the standalone HTML export.
 *
 * Reuses the app's real components so exports always match the app:
 * - TreeView (Sidebar.tsx) for the session tree panel
 * - Breadcrumb / MessageBubble / InlineBranches from @pi-tree/ui
 * - collectScopeMessages / buildBreadcrumb from @pi-tree/core for scope logic
 *
 * All data comes from the embedded snapshot — no network, no mutations.
 */

import { useMemo, useState } from "react";
import { GitBranch } from "lucide-react";
import type { TreeNodeView, ToolStep } from "@pi-tree/core/types";
import { collectScopeMessages, buildBreadcrumb } from "@pi-tree/core/tree-nav";
import { Breadcrumb, MessageBubble, InlineBranches } from "@pi-tree/ui";
import { TreeView } from "../components/Sidebar";
import "./Viewer.css";

/** Mirrors the server's SessionSnapshot (export-service.ts). */
export interface ViewerSnapshot {
  format: string;
  formatVersion: number;
  exportedAt: string;
  source: {
    id: string;
    type: string;
    title: string;
    subtitle?: string;
    author?: string;
    year?: number;
  };
  session: { title: string; mode?: string };
  tree: TreeNodeView;
  contents: Record<
    string,
    { role: string; content: string; timestamp: string; toolSteps?: ToolStep[] }
  >;
  /** Present when the export is scoped to a branch */
  branch?: { nodeId: string; label: string; path: string[] };
}

const NO_GENERATING = new Set<string>();
const NO_NEW_BRANCHES = new Set<string>();

export function Viewer({ snapshot }: { snapshot: ViewerSnapshot }) {
  // Branch exports open scoped at the branch node; the full lineage up to
  // root is in the tree, one breadcrumb click away.
  const [viewNodeId, setViewNodeId] = useState<string | null>(
    snapshot.branch?.nodeId ?? null,
  );

  // Root node label is the sourceId slug — show the source title instead
  const tree = useMemo<TreeNodeView>(
    () => ({ ...snapshot.tree, label: snapshot.source.title }),
    [snapshot],
  );

  const contentMap = useMemo(
    () => new Map(Object.entries(snapshot.contents)),
    [snapshot],
  );

  const scope = useMemo(
    () => collectScopeMessages(tree, viewNodeId, contentMap),
    [tree, viewNodeId, contentMap],
  );

  const breadcrumb = useMemo(
    () => (viewNodeId ? buildBreadcrumb(tree, viewNodeId) : []),
    [tree, viewNodeId],
  );

  const handleNavigate = (nodeId: string) => {
    setViewNodeId(nodeId === "" || nodeId === tree.id ? null : nodeId);
    window.scrollTo(0, 0);
  };

  // Branch previews come straight from the snapshot — same shape the app
  // fetches from the server, resolved locally.
  const fetchBranchPreview = (
    _userId: string,
    _bookId: string,
    _sessionId: number,
    nodeId: string,
  ) => Promise.resolve(collectScopeMessages(tree, nodeId, contentMap));

  const branches = scope.branches.filter(
    (b) => !(b.status === "placeholder" && (b.messageCount ?? 0) === 0),
  );

  const exportedDate = new Date(snapshot.exportedAt).toLocaleDateString();

  return (
    <div className="viewer">
      <aside className="viewer-sidebar">
        <div className="viewer-sidebar-header">
          <GitBranch size={14} /> {snapshot.branch ? "Branch" : "Session Tree"}
        </div>
        <div className="viewer-sidebar-content">
          <TreeView
            tree={tree}
            viewNodeId={viewNodeId ?? tree.id}
            generatingNodeIds={NO_GENERATING}
            onNavigate={handleNavigate}
          />
        </div>
        <div className="viewer-sidebar-footer">
          Exported {exportedDate} ·{" "}
          <a href="https://github.com/shuowu/pi-tree" target="_blank" rel="noopener noreferrer">
            pi-tree
          </a>
        </div>
      </aside>

      <main className="viewer-main">
        <Breadcrumb
          items={breadcrumb}
          onNavigate={handleNavigate}
          bookTitle={snapshot.source.title}
          isScoped={viewNodeId !== null}
          sessionLabel={snapshot.session.title}
        />
        <div className="viewer-chat">
          {scope.messages.length === 0 && branches.length === 0 ? (
            <p className="viewer-empty-scope">No messages in this scope.</p>
          ) : (
            scope.messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
          {branches.length > 0 && (
            <InlineBranches
              branches={branches}
              onDrillDown={handleNavigate}
              bookId={snapshot.source.id}
              sessionId={0}
              userId="viewer"
              newBranchIds={NO_NEW_BRANCHES}
              fetchBranchPreview={fetchBranchPreview}
            />
          )}
        </div>
      </main>
    </div>
  );
}
