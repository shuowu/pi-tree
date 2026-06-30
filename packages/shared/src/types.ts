/**
 * App-level types for pi-tree.
 *
 * Session/tree types (TreeNodeView, ChatMessage, BranchOption, etc.) now
 * live in @pi-tree/core. This package keeps app-specific types:
 * users, sources, library, config, intents, outlines.
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
// Source Types — discriminator for the generic sources model
// ---------------------------------------------------------------------------

/** Source type discriminator. Well-known values: 'book', 'news', 'paper'. Plugins can register additional types. */
export type SourceType = string;

/** Book-specific metadata stored in `sources.metadata` JSON column */
export interface BookMetadata {
  sourceFormat: 'epub' | 'pdf' | 'mobi' | 'markdown' | 'library';
  originalFilename: string;
  folderName: string;
}

/** News collection metadata stored in `sources.metadata` JSON column */
export interface NewsMetadata {
  crawlIntervalMinutes?: number;
}

// ---------------------------------------------------------------------------
// Session — multi-session per source support
// ---------------------------------------------------------------------------

/**
 * Configuration context bound to a specific session.
 *
 * Captures the *intent* of the session at creation time. Today all sessions
 * run the same skills/prompt/model, but storing context now lets us wire
 * per-session behaviour later without schema changes.
 *
 * Future: the server can use this to filter skills, swap system prompts,
 * or select a different model per session.
 */
export interface SessionContext {
  /** Which mode the user picked — extensible to future modes */
  mode: string;
  /** Optional profile name — directly references a registered profile (bypasses sourceType.mode resolution) */
  profile?: string;
  /** Optional skill filter — which skills to enable for this session */
  skills?: string[];
  /** Optional extension filter — which extensions to enable for this session */
  extensions?: string[];
  /** Optional model override — e.g. use a cheaper model for casual Q&A */
  model?: string;
}

/**
 * A session record as returned by the session management API.
 * One user+source pair can have many SourceSessions.
 *
 * When returned from cross-source queries (e.g. recent sessions),
 * the optional source fields are populated.
 */
export interface SourceSession {
  id: number;
  title: string;
  context: SessionContext;
  createdAt: string;
  lastActiveAt: string;
  isActive: boolean;
  /** Populated in cross-source queries */
  sourceId?: string;
  /** Populated in cross-source queries */
  sourceTitle?: string;
  /** Populated in cross-source queries */
  sourceType?: SourceType;
  /** Populated in cross-source queries */
  hasCover?: boolean;
}

/**
 * @deprecated Use `SourceSession` with source fields populated instead.
 * Kept temporarily for backward compatibility.
 */
export type RecentSession = SourceSession;

// ---------------------------------------------------------------------------
// Topic Node — the universal tree node
// ---------------------------------------------------------------------------

export interface TopicNode {
  id: string;
  parentId: string | null; // null = root (source level)

  /** User-visible name: "Ch 3: Radical Open-Mindedness", "Ego barrier", etc. */
  label: string;

  /** Where this node came from */
  source: "outline" | "user" | "auto";

  /** Optional anchor into the source's markdown content */
  contentAnchor?: ContentAnchor;

  /** Node lifecycle */
  status: "active" | "completed" | "abandoned";

  /** Branch summary produced when zooming out */
  summary?: string;

  /** Number of user+assistant message exchanges on this node */
  messageCount: number;

  createdAt: string;
  lastActiveAt: string;
}

export interface ContentAnchor {
  /** Line range in the markdown file (from the outline's navigation map) */
  lineRange: [start: number, end: number];

  /** The heading text from the outline */
  outlineHeading?: string;
}

// ---------------------------------------------------------------------------
// Reading Tree — the full tree for one session
// ---------------------------------------------------------------------------

export interface ReadingTree {
  sourceId: string;
  rootNodeId: string;
  nodes: Map<string, TopicNode>;
  /** The node the user is currently on */
  activeNodeId: string;
}

// ---------------------------------------------------------------------------
// Source — the universal "thing you have conversations about"
// ---------------------------------------------------------------------------

export interface Source {
  id: string;

  /** Discriminator: 'book', 'news', 'paper', 'podcast', ... */
  type: SourceType;

  title: string;
  subtitle?: string;
  author: string;
  year?: number;

  /** Where this source came from */
  source: "library" | "upload" | "system";

  /** Import/processing status */
  status?: "pending" | "processing" | "ready" | "failed";

  /** Error message if import failed */
  error?: string;

  /** Type-specific metadata (BookMetadata, NewsMetadata, etc.) */
  metadata?: Record<string, unknown>;

  // --- Computed/UI fields (not stored in DB) ---

  /** Folder name in the library, e.g. "Principles_Dalio_2017" */
  folderName?: string;

  /** Reading progress 0..1 */
  progress: number;

  /** Whether the source has been converted to markdown */
  hasMarkdown: boolean;

  /** Whether an outline has been generated */
  hasOutline: boolean;

  /** Whether the source has a cover image */
  hasCover?: boolean;

  /** Cover image URL/path */
  coverUrl?: string;

  /** Per-source reading preferences (user-configured, mainly for books) */
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

export interface SourceOutline {
  sourceId: string;
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
   * Placeholders: {{term}}, {{context}}, {{sourceTitle}}
   *
   * The actual default lives in packages/server/prompts/dictionary-prompt.md.
   * User overrides: DATA_PATH/dictionary-prompt.md or DATA_PATH/sources/<sourceId>/dictionary-prompt.md.
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
 *   DATA_PATH       → dataPath      (default: ~/.local/share/pi-tree)
 */
export interface ServerConfig {
  /** Model used for main reading conversations */
  readingModel: string;
  /** Model used for dictionary lookups (fast/cheap preferred) */
  lookupModel: string;
  /** Path for mutable state (sessions, DB) — library lives at dataPath/library/ */
  dataPath?: string;
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  readingModel: "glm-5-turbo",
  lookupModel: "glm-5-turbo",
};

// ---------------------------------------------------------------------------
// Token Usage — per-message token consumption tracking
// ---------------------------------------------------------------------------

/** Token usage data captured from AI model responses */
export interface TokenUsage {
  /** Input/prompt tokens */
  inputTokens: number;
  /** Output/completion tokens */
  outputTokens: number;
  /** Tokens read from cache (prompt caching) */
  cacheReadTokens: number;
  /** Tokens written to cache */
  cacheWriteTokens: number;
  /** Total tokens (inputTokens + outputTokens) */
  totalTokens: number;
  /** Model that generated this response */
  model: string;
  /** Provider that served the request */
  provider: string;
  /** Cost breakdown from the AI SDK (when model pricing is configured) */
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

/** Aggregated token usage stats */
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  messageCount: number;
  costTotal?: number;
  /** Per-model breakdown */
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    messageCount: number;
  }>;
}

// ---------------------------------------------------------------------------
// Intent Classification — server decides branch vs continue
// ---------------------------------------------------------------------------

export type UserIntent =
  | { type: "continue" }
  | { type: "go_deeper"; topic: string }
  | { type: "next_chapter"; chapterLabel?: string }
  | { type: "zoom_out"; targetLevel?: string }
  | { type: "lateral_move"; target: string }
  | { type: "cross_source"; otherSource: string; topic: string }
  | { type: "toc_navigate"; outlineEntry: OutlineEntry };
