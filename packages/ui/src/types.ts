import type { ComponentType, ReactNode } from "react";
import type { Source } from "@pi-tree/shared";

/** Props passed to plugin content panel components by the host RightPanel */
export interface ContentPanelProps {
  sourceId: string;
  onDefine?: (term: string, context?: string) => void;
  onSendMessage?: (message: string) => void;
}

/** Props passed to plugin add-source form components by the AddSourceModal */
export interface AddSourceFormProps {
  /**
   * Called when the source is successfully created. The modal will close.
   * Pass the created source (its id is enough) to let the host navigate
   * straight to it; omit it to stay in the library (e.g. singleton types
   * like the news dashboard, where "add" is feed configuration).
   */
  onSuccess: (source?: { id: string }) => void;
  /** Called when an error occurs. The modal will display the error. */
  onError: (error: string) => void;
}

/** Props passed to custom or generic source card components in the library */
export interface SourceCardProps {
  source: Source;
  onClick: () => void;
  onTagClick: () => void;
  renderCover: (size?: "sm" | "md" | "lg") => ReactNode;
  /** Trigger incremental analysis update (no force) */
  onUpdateSource?: () => void;
  /** Trigger full re-processing (force) */
  onReprocessSource?: () => void;
  /** Toggle the manual finished/done flag (stored in source.metadata.finished) */
  onToggleFinished?: () => void;
}

/** Props passed to plugin items-panel components on the source landing page */
export interface SourceItemsPanelProps {
  source: Source;
  userId: string;
  /** Host-owned navigation: open a source, optionally jumping straight into a session */
  onOpenSource: (sourceId: string, opts?: { sessionId?: number; mode?: string }) => void;
}

/**
 * A client-side plugin that contributes UI for a source type.
 * PayloadCMS-style: each plugin is a factory function returning this descriptor.
 */
export interface ClientPlugin {
  /** Which source type this plugin enhances */
  sourceType: string;
  /** Content panel component shown in the right sidebar */
  contentPanel?: ComponentType<ContentPanelProps>;
  /** Add-source form component rendered in the AddSourceModal */
  addSourceForm?: ComponentType<AddSourceFormProps>;
  /** Optional custom source card component for rendering this source type in the Library */
  sourceCard?: ComponentType<SourceCardProps>;
  /** Items panel rendered as a tab on the source landing page (e.g. crawled news items) */
  itemsPanel?: ComponentType<SourceItemsPanelProps>;
  /** Named modals contributed by this plugin (rendered at app level) */
  modals?: Record<string, ComponentType<{ onClose: () => void }>>;
}
