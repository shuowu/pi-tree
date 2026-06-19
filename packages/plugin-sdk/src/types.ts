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
  /** @deprecated Use `sources` service instead. Raw DB accessor for edge cases. */
  coreDb: () => any;
  /** @deprecated Use `sources` service instead. Raw schema for edge cases. */
  coreSchema: { sources: any };
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
 */
export interface PluginManifest {
  /** Path to the routes module (relative to package.json), e.g. "./routes.ts" */
  routes?: string;
  /** URL prefix for mounting routes, e.g. "/api/news". Defaults to /api/{pluginName} */
  routePrefix?: string;
  /** Source type this plugin provides, e.g. "podcast" */
  sourceType?: string;
  /** Human-readable label for the source type, e.g. "Podcasts" */
  label?: string;
  /** Icon name (lucide icon), e.g. "headphones" */
  icon?: string;
  /** One-line description of the plugin */
  description?: string;
}
