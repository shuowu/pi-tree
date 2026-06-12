import type { SourceType } from "@pi-tree/shared";
import type { LucideIcon } from "lucide-react";
import { BookOpen, Newspaper, FileText, Headphones } from "lucide-react";

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
  /** Whether to show the content reader panel (markdown viewer) */
  hasContentPanel: boolean;
  /** Search placeholder text for the library */
  searchPlaceholder: string;
  /** Chat input placeholder text */
  chatPlaceholder: string;
}

export const SOURCE_TYPE_CONFIGS: Record<SourceType, SourceTypeConfig> = {
  book: {
    label: "Book",
    icon: BookOpen,
    sessionModes: ["reading", "qa", "custom"],
    defaultMode: "reading",
    hasProcessing: true,
    hasContentPanel: true,
    searchPlaceholder: "Search books...",
    chatPlaceholder: "Ask about the book, or try: deep dive, next chapter, zoom out…",
  },
  news: {
    label: "News Feed",
    icon: Newspaper,
    sessionModes: ["news"],
    defaultMode: "news",
    autoStartMode: "news",
    hasProcessing: false,
    hasContentPanel: false,
    searchPlaceholder: "Search feeds...",
    chatPlaceholder: "Ask about the news, or try: trends, deep dive, scan AI…",
  },
  paper: {
    label: "Paper",
    icon: FileText,
    sessionModes: ["reading", "custom"],
    defaultMode: "reading",
    autoStartMode: "reading",
    hasProcessing: false,
    hasContentPanel: false,
    searchPlaceholder: "Search papers...",
    chatPlaceholder: "Search arXiv, paste a paper ID, or ask about research topics…",
  },
  podcast: {
    label: "Podcast",
    icon: Headphones,
    sessionModes: ["custom"],
    defaultMode: "custom",
    hasProcessing: false,
    hasContentPanel: false,
    searchPlaceholder: "Search podcasts...",
    chatPlaceholder: "Ask about the episode, or try: key takeaways, topics…",
  },
};

/** Get config for a source type, with a fallback to book config */
export function getSourceTypeConfig(type: SourceType): SourceTypeConfig {
  return SOURCE_TYPE_CONFIGS[type] ?? SOURCE_TYPE_CONFIGS.book;
}
