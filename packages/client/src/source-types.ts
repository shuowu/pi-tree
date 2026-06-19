import type { ComponentType } from "react";
import type { AddSourceFormProps } from "@pi-tree/ui";
import type { LucideIcon } from "lucide-react";
import { Puzzle } from "lucide-react";
import type { ContentPanelProps } from "@pi-tree/ui";
import { resolveIcon } from "./utils/resolve-icon";
import appConfig from "./pi-tree.config";

export type { ContentPanelProps } from "@pi-tree/ui";

/** Configuration for how each source type renders in the UI */
export interface SourceTypeConfig {
  /** Human-readable label */
  label: string;
  /** Icon for library cards and headers */
  icon: LucideIcon;
  /** Available session modes for "new session" UI */
  sessionModes: string[];
  /** Default mode when auto-creating first session */
  defaultMode: string;
  /** If set, skip welcome screen and auto-create session with this mode */
  autoStartMode?: string;
  /** Whether this source type supports book processing (EPUB conversion, outline generation) */
  hasProcessing: boolean;
  /** Optional content panel component for the right sidebar's second tab */
  contentPanel?: ComponentType<ContentPanelProps>;
  /** Search placeholder text for the library */
  searchPlaceholder: string;
  /** Chat input placeholder text */
  chatPlaceholder: string;
  /** Config for the Add Source modal tab. If absent, this type won't appear in the modal. */
  addSource?: {
    subtitle: string;
    hasFileUpload?: boolean;
    acceptedExtensions?: string[];
    fields: Array<{
      key: string;
      label: string;
      placeholder?: string;
      type?: "text" | "number";
      required?: boolean;
      metadataKey?: string;
    }>;
  };
  /** Optional custom React component for the add-source form (from plugin) */
  addSourceForm?: ComponentType<AddSourceFormProps>;
  /** Template for library card subtitle, e.g. "{author}, {year}". Supports {field} placeholders. */
  cardSubtitle?: string;
  /** Badge definitions for library cards — declared by plugins */
  badges?: Array<{
    field: string;
    value?: string;
    label: string;
    color: string;
  }>;
}



// ---------------------------------------------------------------------------
// Source type registry — populated from server, content panels from plugins
// ---------------------------------------------------------------------------

export const SOURCE_TYPE_CONFIGS: Record<string, SourceTypeConfig> = {};

/** Generic fallback for unknown source types */
const GENERIC_CONFIG: SourceTypeConfig = {
  label: "Source",
  icon: Puzzle,
  sessionModes: ["reading", "custom"],
  defaultMode: "reading",
  autoStartMode: "reading",
  hasProcessing: false,
  searchPlaceholder: "Search sources...",
  chatPlaceholder: "Ask questions about this source…",
};

/**
 * Fetch source type configs from the server and populate SOURCE_TYPE_CONFIGS.
 * Content panels are injected from the resolved plugin config.
 * Call this once at app startup.
 */
export async function loadSourceTypes(): Promise<void> {
  try {
    const res = await fetch("/api/config/source-types");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    for (const st of data.sourceTypes) {
      SOURCE_TYPE_CONFIGS[st.key] = {
        label: st.label,
        icon: resolveIcon(st.icon),
        sessionModes: st.sessionModes,
        defaultMode: st.defaultMode,
        autoStartMode: st.autoStartMode,
        hasProcessing: st.hasProcessing ?? false,
        contentPanel: appConfig.contentPanels[st.key],
        searchPlaceholder: st.searchPlaceholder ?? "Search...",
        chatPlaceholder: st.chatPlaceholder ?? "Ask a question…",
        addSource: st.addSource ?? undefined,
        addSourceForm: appConfig.addSourceForms[st.key],
        cardSubtitle: st.cardSubtitle ?? undefined,
        badges: st.badges ?? undefined,
      };
    }

    console.log(`[pi-tree] Loaded ${data.sourceTypes.length} source type(s) from server`);
  } catch (err) {
    console.warn("[pi-tree] Failed to load source types from server", err);
  }
}

/** Get config for a source type, with a generic fallback for unknown types */
export function getSourceTypeConfig(type: string): SourceTypeConfig {
  return SOURCE_TYPE_CONFIGS[type] ?? GENERIC_CONFIG;
}

/**
 * Resolve a cardSubtitle template against a source's properties.
 * Substitutes `{field}` placeholders with source values.
 * Falls back to `source.author` if no template is defined.
 */
export function resolveCardSubtitle(
  template: string | undefined,
  source: Record<string, unknown>,
): string {
  if (!template) {
    // Default: author only
    return (source.author as string) || "";
  }
  const result = template.replace(/\{(\w+)\}/g, (_match, field: string) => {
    const val = source[field];
    return val != null && val !== "" ? String(val) : "";
  });
  // Clean up dangling separators from empty fields (e.g. "Author, " when year is empty)
  return result.replace(/[,;]\s*$/g, "").replace(/^[,;]\s*/g, "").trim();
}
