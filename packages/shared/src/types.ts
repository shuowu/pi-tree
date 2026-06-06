/**
 * Core types for the pi-books reading tree.
 *
 * Every node in the reading tree is a TopicNode — no rigid hierarchy.
 * Chapters, sub-topics, tangents, and cross-book references are all just
 * nodes with different labels and optional book anchors.
 */

// ---------------------------------------------------------------------------
// User — simple identity, no auth
// ---------------------------------------------------------------------------

export interface UserInfo {
  id: string; // slug like "shuo", "alice"
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

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

  /** Whether the book has a cover image */
  hasCover?: boolean;

  /** Where this book came from */
  source: "library" | "upload";

  /** Import status for uploaded books */
  status?: "pending" | "processing" | "ready" | "failed";

  /** Error message if import failed */
  error?: string;

  /** Per-book reading preferences (user-configured) */
  preferences?: BookPreferences;

  /** User-defined tags for categorization and filtering */
  tags?: string[];
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
  /**
   * Whether auto-compaction is enabled. When true, Pi SDK automatically
   * compacts older messages into a summary when context nears the model's
   * window limit. This is append-only — raw messages remain in the JSONL
   * and are always visible in the tree/chat UI.
   */
  autoCompact: boolean;
}

export interface NavigationConfig {
  autoBranchOnChapter: boolean;
  /** Ask user before creating tangent branches */
  confirmBranch: boolean;
  /** Ask user before summarizing and zooming out */
  confirmZoomOut: boolean;
}

export interface LookupConfig {
  /**
   * Prompt template for dictionary lookups.
   * Placeholders: {{term}}, {{context}}, {{bookTitle}}
   *
   * The actual default lives in packages/server/prompts/dictionary-prompt.md.
   * User overrides: DATA_PATH/dictionary-prompt.md or DATA_PATH/books/<bookId>/dictionary-prompt.md.
   * This field is only used as a last-resort compiled-in fallback.
   */
  promptTemplate: string;
}

export interface ReaderConfig {
  summary: SummaryConfig;
  compaction: CompactionConfig;
  navigation: NavigationConfig;
  lookup: LookupConfig;
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
  },
  navigation: {
    autoBranchOnChapter: true,
    confirmBranch: false,
    confirmZoomOut: false,
  },
  lookup: {
    promptTemplate: 'Define "{{term}}" concisely.',
  },
};

// ---------------------------------------------------------------------------
// Server Config — global settings from environment variables
// ---------------------------------------------------------------------------

/**
 * Server-level configuration, read from env vars at startup.
 * NOT per-user — these are infrastructure/deployment settings.
 *
 * Env vars:
 *   PI_MODEL        → readingModel  (default: "glm-5-turbo")
 *   PI_LOOKUP_MODEL → lookupModel   (default: same as readingModel)
 *   LIBRARY_PATH    → libraryPath   (default: ~/.local/share/pi-books/library)
 *   DATA_PATH       → dataPath      (default: ~/.local/share/pi-books)
 */
export interface ServerConfig {
  /** Model used for main reading conversations */
  readingModel: string;
  /** Model used for dictionary lookups (fast/cheap preferred) */
  lookupModel: string;
  /** Path to the book library on disk */
  libraryPath?: string;
  /** Path for mutable state (sessions, DB) */
  dataPath?: string;
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  readingModel: "glm-5-turbo",
  lookupModel: "glm-5-turbo",
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
  userId: string;
  bookId: string;
  activeNodeId: string;
  /** Which tree node the chat view is scoped to (null = root) */
  viewNodeId: string | null;
  breadcrumb: BreadcrumbItem[];
  /** Messages in the current scope (linear chain from viewNode to next fork) */
  messages: ChatMessage[];
  tree: TreeNodeView;
  /** Branches available at the end of the current chain (fork indicator) */
  branches: BranchOption[];
}

export interface BranchOption {
  nodeId: string;
  label: string;
  messageCount: number;
  status: "active" | "completed" | "abandoned";
}

export interface BreadcrumbItem {
  nodeId: string;
  label: string;
}
