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
 *   coreDir/agents/skills/      — core skill directories
 *   coreDir/agents/extensions/  — core extension directories
 *   coreDir/profiles/           — core session profiles (YAML)
 *   dataDir/skills/             — user skill overrides
 *   dataDir/extensions/         — user extension overrides
 *   dataDir/profiles/           — user-defined session profiles (YAML)
 */
export interface AgentRegistryConfig {
  /** Root for core assets (import.meta.dirname in server entry, e.g. src/ or dist/) */
  coreDir: string;
  /** Root for user overrides ($DATA_PATH, e.g. ~/.local/share/pi-tree/) */
  dataDir: string;
}

/** Result of registry validation */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
