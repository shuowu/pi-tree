import type { SessionContext } from "@pi-tree/shared";

// ---------------------------------------------------------------------------
// Skill & Extension entries — populated by the registry during discovery
// ---------------------------------------------------------------------------

/** Metadata for a discovered skill directory */
export interface SkillEntry {
  /** Skill name (directory basename, e.g. "interactive-reading") */
  name: string;
  /** Absolute path to the skill directory */
  path: string;
  /** Where this skill was loaded from */
  source: "core" | "user";
}

/** Metadata for a discovered extension directory */
export interface ExtensionEntry {
  /** Extension name (directory basename, e.g. "library") */
  name: string;
  /** Absolute path to the extension directory */
  path: string;
  /** Where this extension was loaded from */
  source: "core" | "user";
}

// ---------------------------------------------------------------------------
// Session profiles — declarative mapping of capabilities per session type
// ---------------------------------------------------------------------------

/** A session profile — the "recipe" for what an agent session gets */
export interface SessionProfile {
  /** Human-readable label */
  label: string;
  /** One-line description */
  description?: string;
  /** Source type this profile applies to (e.g. "book", "news") */
  sourceType?: string;
  /** Which skills to load (by registered name) */
  skills: string[];
  /** Which extensions to load (by registered name) */
  extensions: string[];
  /** Pi SDK tools to exclude (e.g. ["bash", "edit"]) */
  excludeTools: string[];
  /** Model override — falls back to server default if not set */
  model?: string;
  /** Lucide icon name for UI display (e.g. "book-open") */
  icon?: string;
  /** First message template — {sourceTitle} interpolated at runtime */
  defaultPrompt?: string;
  /** Default title template — {sourceTitle} and {date} interpolated */
  defaultTitle?: string;
  /** Quick-action buttons shown in the session UI */
  quickActions?: Array<{
    label: string;
    icon: string;
    prompt: string;
    /** If set, shows a text input before sending */
    inputPlaceholder?: string;
    /** Session title template — {input} and {date} interpolated */
    titleTemplate?: string;
  }>;
  /** Display order in the UI (lower = first). Defaults to 100. */
  order: number;
}

/** The resolved profile with absolute paths ready for PiSession */
export interface ResolvedProfile extends SessionProfile {
  /** Profile key that was resolved (e.g. "book.reading", "_default") */
  resolvedFrom: string;
  /** Resolved absolute paths for skills */
  skillPaths: string[];
  /** Resolved absolute paths for extensions */
  extensionPaths: string[];
}

// ---------------------------------------------------------------------------
// Registry initialization config
// ---------------------------------------------------------------------------

/**
 * Two-root configuration for the agent registry.
 *
 * All subdirectory conventions are handled inside the registry:
 *   corePluginDirs — individual core plugin directories (each scanned for extensions, skills, profiles, routes, source types)
 *   coreDir/agents/skills/ — core skills (legacy standalone, backward compat)
 *   coreDir/profiles/ — core session profiles (YAML)
 *   dataDir/extensions/ — user extensions (also scanned for bundled pi.skills)
 *   dataDir/skills/ — user skill overrides
 *   dataDir/profiles/ — user-defined session profiles (YAML)
 *
 * If `corePluginDirs` is not provided, falls back to `coreDir/agents/extensions/`.
 */
export interface AgentRegistryConfig {
  /** Root for core assets (import.meta.dirname in server entry, e.g. src/ or dist/) */
  coreDir: string;
  /** Root for user overrides ($DATA_PATH, e.g. ~/.local/share/pi-tree/) */
  dataDir: string;
  /** Individual plugin directories to scan. Falls back to coreDir/agents/extensions/ */
  corePluginDirs?: string[];
  /** Optional additional skills directory ($SKILLS_PATH) — scanned after dataDir/skills/ */
  skillsPath?: string;
  /** Optional additional extensions directory ($EXTENSIONS_PATH) — scanned after dataDir/extensions/ */
  extensionsPath?: string;
}

/** Result of registry validation */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Metadata for a plugin route module discovered from piTree.routes manifest */
export interface PluginRouteEntry {
  /** Plugin name (directory basename) */
  name: string;
  /** Absolute path to the routes module */
  routesPath: string;
  /** URL prefix for mounting (e.g. "/api/news") */
  prefix: string;
}

/** Metadata for a plugin-contributed source type (discovered from piTree.sourceType manifest) */
export interface SourceTypeEntry {
  /** Unique source type key (e.g. "book", "news") */
  key: string;
  /** Human-readable label */
  label: string;
  /** Lucide icon name (kebab-case, e.g. "book-open") */
  icon: string;
  /** Available session modes */
  sessionModes: string[];
  /** Default mode when auto-creating first session */
  defaultMode: string;
  /** If set, skip welcome screen and auto-create session with this mode */
  autoStartMode?: string;
  /** Whether this source type supports processing (e.g. EPUB conversion) */
  hasProcessing: boolean;
  /** Search placeholder text for the library */
  searchPlaceholder?: string;
  /** Chat input placeholder text */
  chatPlaceholder?: string;
  /** Keyword matched in @mentions (e.g. "News", "Paper"). If omitted, source titles are fuzzy-matched. */
  mentionKeyword?: string;
  /** Fixed source ID for singleton source types (e.g. "news"). If omitted, resolved via title search. */
  fixedSourceId?: string;
  /** Session reuse strategy: 'reuse-same-mode' (default) or 'time-based' */
  sessionStrategy?: 'reuse-same-mode' | 'time-based';
  /** For time-based strategy: hours after which to suggest asking user (default: 4) */
  askAfterHours?: number;
  /** For time-based strategy: hours after which session is considered stale (default: 12) */
  staleAfterHours?: number;
  /** Relative path from $DATA_PATH to a JSON config file that provides routing context (e.g. 'news/feeds.json') */
  routingContextFile?: string;
  /** Human-readable label describing the routing context (e.g. 'feeds and tags') */
  routingContextLabel?: string;
  /** Configuration for the 'Add Source' modal tab. If absent, this type doesn't appear in the modal. */
  addSource?: {
    /** Subtitle shown below the tab header */
    subtitle: string;
    /** Whether this tab supports file upload */
    hasFileUpload?: boolean;
    /** Accepted file extensions for upload (e.g. [".epub", ".pdf"]) */
    acceptedExtensions?: string[];
    /** Form fields to render */
    fields: Array<{
      key: string;
      label: string;
      placeholder?: string;
      type?: "text" | "number";
      required?: boolean;
      /** If set, this field's value goes into metadata[metadataKey] instead of top-level */
      metadataKey?: string;
    }>;
  };
  /** Template for the library card subtitle, e.g. "{author}, {year}". Supports {field} placeholders resolved from source properties. */
  cardSubtitle?: string;
  /** Badge definitions for library cards. Each badge checks a source field for truthiness or equality. */
  badges?: Array<{
    /** Source property to check (e.g. "hasMarkdown", "source", "status") */
    field: string;
    /** If set, check equality (`source[field] === value`). If omitted, check truthiness. */
    value?: string;
    /** Badge label text */
    label: string;
    /** Badge color: "green" | "amber" | "blue" | "red" */
    color: string;
  }>;
  /** Which plugin contributed this source type */
  pluginName: string;
  /** Whether this plugin has a UI component */
  hasUI: boolean;
  /** Absolute path to the plugin directory */
  pluginDir: string;
  /** Optional custom system context prompt template */
  systemContext?: string[];
  /** Prompt template for #tag mentions. `{tags}` is replaced with the tag list. E.g. "Focus on feeds tagged '{tags}'" */
  tagPromptTemplate?: string;
  /** Prompt template for :qualifier mentions. `{qualifier}` is replaced with the value. E.g. "Focus on the {qualifier} feed" */
  qualifierPromptTemplate?: string;
}
