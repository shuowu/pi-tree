/**
 * Core types for the pi-reader reading tree.
 *
 * Every node in the reading tree is a TopicNode — no rigid hierarchy.
 * Chapters, sub-topics, tangents, and cross-book references are all just
 * nodes with different labels and optional book anchors.
 */

// ---------------------------------------------------------------------------
// Topic Node — the universal tree node
// ---------------------------------------------------------------------------

export interface TopicNode {
  id: string;
  parentId: string | null; // null = root (book level)

  /** User-visible name: "Ch 3: Radical Open-Mindedness", "Ego barrier", etc. */
  label: string;

  /** Where this node came from */
  source: "outline" | "user" | "auto";

  /** Optional anchor into the book's markdown content */
  bookAnchor?: BookAnchor;

  /** Node lifecycle */
  status: "active" | "completed" | "abandoned";

  /** Branch summary produced when zooming out */
  summary?: string;

  /** Number of user+assistant message exchanges on this node */
  messageCount: number;

  createdAt: string;
  lastActiveAt: string;
}

export interface BookAnchor {
  /** Line range in the markdown file (from the outline's navigation map) */
  lineRange: [start: number, end: number];

  /** The heading text from the outline, e.g. "### Chapter 3: Be Radically Open-Minded" */
  outlineHeading?: string;
}

// ---------------------------------------------------------------------------
// Reading Tree — the full tree for one book session
// ---------------------------------------------------------------------------

export interface ReadingTree {
  bookId: string;
  rootNodeId: string;
  nodes: Map<string, TopicNode>;
  /** The node the user is currently on */
  activeNodeId: string;
}

// ---------------------------------------------------------------------------
// Book & Library
// ---------------------------------------------------------------------------

export interface Book {
  id: string;

  title: string;
  author: string;
  year: number;

  /** Folder name in the library, e.g. "Principles_Dalio_2017" */
  folderName: string;

  /** Reading progress 0..1 */
  progress: number;

  /** Whether the book has been converted to markdown */
  hasMarkdown: boolean;

  /** Whether an outline has been generated */
  hasOutline: boolean;

  /** BOOK.md preferences, if present */
  preferences?: BookPreferences;
}

export interface BookPreferences {
  language?: string;
  readingStyle?: "dense" | "concise" | "socratic";
  quoteKeyPassages?: boolean;
  depth?: "philosophical" | "practical" | "academic";
  focusAreas?: string[];
  summaryDetail?: SummaryDetailLevel;
  summaryFocus?: SummaryFocus;
}

// ---------------------------------------------------------------------------
// Outline — generated from book-outline skill
// ---------------------------------------------------------------------------

export interface OutlineEntry {
  /** Line number in the markdown file */
  line: number;

  /** Heading level (1 = #, 2 = ##, etc.) */
  level: number;

  /** Heading text */
  title: string;

  /** Child entries */
  children: OutlineEntry[];
}

export interface BookOutline {
  bookId: string;
  summary: string;
  thesis?: string;
  entries: OutlineEntry[];
  thematicMap?: ThematicMapEntry[];
  readingRecommendations?: ReadingRecommendation[];
}

export interface ThematicMapEntry {
  theme: string;
  lines: number[];
  description: string;
}

export interface ReadingRecommendation {
  type: "must-read" | "skimmable" | "prerequisite";
  chapters: string[];
  reason?: string;
}

// ---------------------------------------------------------------------------
// Summary & Compaction Configuration
// ---------------------------------------------------------------------------

export type SummaryDetailLevel = "brief" | "medium" | "detailed";
export type SummaryFocus =
  | "balanced"
  | "practical"
  | "philosophical"
  | "arguments"
  | "quotes";

export interface SummaryConfig {
  autoOnZoomOut: boolean;
  autoOnChapterChange: boolean;
  detailLevel: SummaryDetailLevel;
  focus: SummaryFocus;
  language?: string;
  includeUserNotes: boolean;
}

export interface CompactionConfig {
  autoCompact: boolean;
  /** Number of messages before auto-compaction triggers */
  threshold: number;
  /** Always keep the last N messages in full (not compacted) */
  keepRecent: number;
}

export interface NavigationConfig {
  autoBranchOnChapter: boolean;
  /** Ask user before creating tangent branches */
  confirmBranch: boolean;
  /** Ask user before summarizing and zooming out */
  confirmZoomOut: boolean;
}

export interface ReaderConfig {
  summary: SummaryConfig;
  compaction: CompactionConfig;
  navigation: NavigationConfig;
}

export const DEFAULT_CONFIG: ReaderConfig = {
  summary: {
    autoOnZoomOut: true,
    autoOnChapterChange: true,
    detailLevel: "medium",
    focus: "balanced",
    includeUserNotes: true,
  },
  compaction: {
    autoCompact: true,
    threshold: 40,
    keepRecent: 15,
  },
  navigation: {
    autoBranchOnChapter: true,
    confirmBranch: false,
    confirmZoomOut: false,
  },
};

// ---------------------------------------------------------------------------
// Intent Classification — server decides branch vs continue
// ---------------------------------------------------------------------------

export type UserIntent =
  | { type: "continue" }
  | { type: "go_deeper"; topic: string }
  | { type: "next_chapter"; chapterLabel?: string }
  | { type: "zoom_out"; targetLevel?: string }
  | { type: "lateral_move"; target: string }
  | { type: "cross_book"; otherBook: string; topic: string }
  | { type: "toc_navigate"; outlineEntry: OutlineEntry };

// ---------------------------------------------------------------------------
// API types — shared between client and server
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Timestamp ISO string */
  timestamp: string;
  /** If this message triggered a branch, the new node id */
  branchedToNodeId?: string;
}

export interface TreeNodeView {
  id: string;
  parentId: string | null;
  label: string;
  status: "active" | "completed" | "abandoned";
  messageCount: number;
  summary?: string;
  children: TreeNodeView[];
  /** Whether this is the currently active node */
  isCurrent: boolean;
}

export interface SessionState {
  bookId: string;
  activeNodeId: string;
  breadcrumb: BreadcrumbItem[];
  messages: ChatMessage[];
  tree: TreeNodeView;
}

export interface BreadcrumbItem {
  nodeId: string;
  label: string;
}
