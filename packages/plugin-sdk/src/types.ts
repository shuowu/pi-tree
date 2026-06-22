/**
 * Services available to pi-tree plugins.
 * Populated by the server at startup via globalThis.__piTreeServices.
 */
export interface PiTreeServices {
  /** Source queries: list, get */
  sources: SourceService;
  /** Session queries: listForSource, create, resolveUserId, getById */
  sessions: SessionService;
  /** User queries: get, ensureExists */
  users: UserService;
  /** Agent registry: profile introspection */
  registry: RegistryService;
  /** Extension configuration (API keys, feature flags) */
  config: ExtensionConfig;
  /** Get the scoped data directory for a plugin. Creates it if needed. */
  getPluginDataDir(pluginName: string): string;
  /** Get the data directory for a registered source. Creates it if needed. */
  getSourceDataDir(sourceId: string): string;
  /** MCP bridge for external tool access (only when mcp.json exists) */
  mcpBridge?: any;
  /** Absolute path to the mutable data directory */
  dataPath: string;
  /** Raw Drizzle DB instance getter (power users, backward compat) */
  db: () => any;
  /** Raw Drizzle schema tables (power users, backward compat) */
  schema: { sources: any; userSessions: any; users: any };
}

// ---------------------------------------------------------------------------
// Service interfaces — these match the implementations in @pi-tree/server
// ---------------------------------------------------------------------------

export interface SourceListItem {
  id: string;
  type: string;
  title: string;
  author: string;
  year: number | null;
}

export interface SourceInfo {
  id: string;
  type: string;
  title: string;
  subtitle?: string | null;
  author: string;
  year: number | null;
  source?: string;
  status?: string;
  error?: string | null;
  metadata?: any;
  coverUrl?: string | null;
}

export interface CreateSourceInput {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  author?: string;
  year?: number;
  source?: string;    // 'library' | 'upload' | 'system'
  status?: string;    // 'pending' | 'processing' | 'ready' | 'failed'
  error?: string | null;
  metadata?: any;
  coverUrl?: string;
}

export interface SourceService {
  /** List sources, excluding type='router'. Optional type & search filters. */
  list(filter?: { type?: string; search?: string }): SourceListItem[];
  /** Get full source info by ID. Returns null if not found. */
  get(id: string): SourceInfo | null;
  /** Create a new source. Returns the created source. No-ops if ID already exists. */
  create(input: CreateSourceInput): SourceInfo;
  /** Update an existing source. Only provided fields are updated. */
  update(id: string, fields: Partial<Omit<CreateSourceInput, "id">>): void;
}

export interface SessionInfo {
  id: number;
  title: string;
  context: string;
  lastActiveAt: string;
  sourceId: string;
  sessionFile: string;
}

export interface SessionService {
  listForSource(userId: string, sourceId: string): SessionInfo[];
  create(
    userId: string,
    sourceId: string,
    opts: {
      title: string;
      context: Record<string, any>;
      sessionFile?: string;
    },
  ): SessionInfo;
  resolveUserId(sessionFile: string): string | undefined;
  /** Look up a single session by its numeric ID. */
  getById(sessionId: number): SessionInfo | null;
}

export interface UserInfo {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface UserService {
  get(id: string): UserInfo | null;
  ensureExists(id: string): UserInfo;
}

// ---------------------------------------------------------------------------
// Registry service — profile introspection
// ---------------------------------------------------------------------------

export interface ProfileInfo {
  /** Profile key (e.g. "socratic-discussion") */
  name: string;
  /** Human-readable label */
  label: string;
  /** One-line description */
  description?: string;
  /** Source type this profile applies to (e.g. "book", "news") */
  sourceType?: string;
  /** Skill names loaded by this profile */
  skills: string[];
  /** Extension names loaded by this profile */
  extensions: string[];
}

export interface SourceTypeInfo {
  key: string;
  label: string;
  mentionKeyword?: string;
  fixedSourceId?: string;
  defaultMode: string;
  sessionModes: string[];
  sessionStrategy?: 'reuse-same-mode' | 'time-based';
  askAfterHours?: number;
  staleAfterHours?: number;
  routingContextFile?: string;
  routingContextLabel?: string;
}

export interface RegistryService {
  /** Return all registered session profiles as a Map of name → ProfileInfo. */
  getProfiles(): Map<string, ProfileInfo>;
  /** Return all registered source types with routing metadata. */
  getSourceTypes(): SourceTypeInfo[];
  /** Resolve a session profile by source type and optional mode. */
  resolveProfile(sourceType: string, mode?: string, sessionContext?: any): {
    skills: string[];
    extensions: string[];
    excludeTools?: string[];
    model?: string;
    defaultTitle?: string;
  };
}

// ---------------------------------------------------------------------------
// Extension configuration
// ---------------------------------------------------------------------------

export interface ExtensionConfig {
  /** Jina Reader API key for article extraction (optional) */
  jinaApiKey?: string;
}

// ---------------------------------------------------------------------------
// Plugin routes — types for plugin-registered HTTP routes
// ---------------------------------------------------------------------------

/**
 * Context passed to a plugin's `setup()` function when mounting routes.
 * The server provides these at startup; the plugin uses them to create
 * its routes, services, and background tasks.
 */
export interface PluginRouteContext {
  /** Scoped data directory for this plugin (e.g. $DATA_PATH/plugins/news/) */
  dataDir: string;
  /** Shared data directory (e.g. $DATA_PATH) — for accessing source content, etc. */
  dataPath: string;
  /** Typed source service for creating/reading/updating core source entries */
  sources: SourceService;
  /** Session service for listing/creating sessions */
  sessions: SessionService;
  /** User service for user lookup */
  users: UserService;
  /** Agent registry for profile/source-type introspection */
  registry: RegistryService;
  /** Extension configuration (API keys, feature flags) */
  config: ExtensionConfig;
}

/**
 * Return value from a plugin's `setup()` function.
 * The server mounts `routes` at the plugin's declared prefix
 * and calls `cleanup()` on server shutdown.
 */
export interface PluginSetupResult {
  /** Hono sub-app with the plugin's HTTP routes */
  routes: any; // Hono instance — typed as any to avoid hard Hono dependency
  /** Optional cleanup function called on server shutdown */
  cleanup?: () => void;
}

// ---------------------------------------------------------------------------
// Plugin manifest — the piTree field in package.json
// ---------------------------------------------------------------------------

/**
 * The `piTree` field in a plugin's package.json.
 * Declares plugin capabilities that the server discovers at startup.
 *
 * Validated at startup by the server's manifest-schema.ts (Zod).
 */
export interface PluginManifest {
  /** Source type registration — describes a new kind of source this plugin provides */
  sourceType?: {
    /** Unique source type key (e.g. "book", "news"). Lowercase alphanumeric + hyphens. */
    key: string;
    /** Human-readable label (e.g. "Book", "News Feed") */
    label?: string;
    /** Lucide icon name in kebab-case (e.g. "book-open") */
    icon?: string;
    /** Available session modes (e.g. ["reading", "qa", "custom"]) */
    sessionModes?: string[];
    /** Default mode when auto-creating the first session */
    defaultMode?: string;
    /** If set, skip welcome screen and auto-create session with this mode */
    autoStartMode?: string;
    /** Whether this source type supports processing (e.g. EPUB conversion) */
    hasProcessing?: boolean;
    /** Search placeholder text for the library filter bar */
    searchPlaceholder?: string;
    /** Chat input placeholder text */
    chatPlaceholder?: string;
    /** Keyword matched in @mentions (e.g. "News", "Paper") */
    mentionKeyword?: string;
    /** Fixed source ID for singleton source types (e.g. "news") */
    fixedSourceId?: string;
    /** Session reuse strategy */
    sessionStrategy?: "reuse-same-mode" | "time-based";
    /** For time-based strategy: hours after which to prompt user (default: 4) */
    askAfterHours?: number;
    /** For time-based strategy: hours after which session is stale (default: 12) */
    staleAfterHours?: number;
    /** Relative path from $DATA_PATH to routing context JSON */
    routingContextFile?: string;
    /** Human-readable label for routing context (e.g. "feeds and tags") */
    routingContextLabel?: string;
    /** Configuration for the "Add Source" modal tab */
    addSource?: {
      subtitle: string;
      hasFileUpload?: boolean;
      acceptedExtensions?: string[];
      fields?: Array<{
        key: string;
        label: string;
        placeholder?: string;
        type?: "text" | "number";
        required?: boolean;
        metadataKey?: string;
      }>;
    };
    /** Library card subtitle template (e.g. "{author}, {year}") */
    cardSubtitle?: string;
    /** Badge definitions for library cards */
    badges?: Array<{
      field: string;
      value?: string;
      label: string;
      color: "green" | "amber" | "blue" | "red";
    }>;
    /** Custom system context prompt template (one line per array element) */
    systemContext?: string[];
    /** Prompt template for #tag mentions */
    tagPromptTemplate?: string;
    /** Prompt template for :qualifier mentions */
    qualifierPromptTemplate?: string;
  };
  /** Path to the routes module (relative to package.json), e.g. "./routes.ts" */
  routes?: string;
  /** URL prefix for mounting routes, e.g. "/api/news". Defaults to /api/{pluginName} */
  routePrefix?: string;
  /** Client-side UI component declarations */
  ui?: {
    /** Path to the content panel component (relative to package.json) */
    contentPanel?: string;
  };
}
