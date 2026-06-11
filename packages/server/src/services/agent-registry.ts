import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import yaml from "js-yaml";
import { z } from "zod";
import type { SessionContext } from "@pi-tree/shared";
import type {
  SkillEntry,
  ExtensionEntry,
  SessionProfile,
  ResolvedProfile,
  AgentRegistryConfig,
  ValidationResult,
} from "../types/agent.js";
// ---------------------------------------------------------------------------
// Profile YAML schema — validated with Zod
// ---------------------------------------------------------------------------

/**
 * Zod schema for session profile YAML files.
 *
 * Uses `strictObject` so unknown fields (e.g. typo "skill" instead of "skills")
 * are caught and reported rather than silently ignored.
 */
export const profileSchema = z.strictObject({
  /** Profile key — used to reference this profile (e.g. "book.reading") */
  name: z.string().min(1, "name must be a non-empty string"),
  /** Human-readable label shown in the UI */
  label: z.string().optional(),
  /** One-line description (informational only, not used at runtime) */
  description: z.string().optional(),
  /** Source type this profile applies to (e.g. "book", "news"). Shown only for matching sources. */
  source_type: z.string().optional(),
  /** Skill names to load (must exist in skills directories) */
  skills: z.array(z.string()),
  /** Extension names to load (default: []) */
  extensions: z.array(z.string()).default([]),
  /** Pi SDK tools to block (default: ["bash", "edit"]) */
  exclude_tools: z.array(z.string()).default(["bash", "edit"]),
  /** Model override — falls back to server default if not set */
  model: z.string().optional(),
});

export type ProfileYaml = z.infer<typeof profileSchema>;

// ---------------------------------------------------------------------------
// AgentRegistry — discovery, validation, and profile resolution
// ---------------------------------------------------------------------------

export class AgentRegistry {
  private skills = new Map<string, SkillEntry>();
  private extensions = new Map<string, ExtensionEntry>();
  private profiles = new Map<string, SessionProfile>();

  /**
   * Initialize the registry: scan directories and populate maps.
   * Called once at server startup.
   *
   * Derives all paths from the two-root config:
   *   coreDir/agents/skills/      → core skills
   *   coreDir/agents/extensions/  → core extensions
   *   coreDir/profiles/           → core session profiles
   *   dataDir/skills/             → user skill overrides
   *   dataDir/extensions/         → user extension overrides
   *   dataDir/profiles/           → user-defined session profiles
   */
  initialize(config: AgentRegistryConfig): void {
    this.skills.clear();
    this.extensions.clear();
    this.profiles.clear();

    // --- Discover skills ---
    // Core skills first, then user skills override (user wins on name collision)
    this.discoverSkills(join(config.coreDir, "agents", "skills"), "core");
    this.discoverSkills(join(config.dataDir, "skills"), "user");

    // --- Discover extensions ---
    this.discoverExtensions(join(config.coreDir, "agents", "extensions"), "core");
    this.discoverExtensions(join(config.dataDir, "extensions"), "user");

    // --- Load profiles ---
    // Core profiles first (shipped YAML), then user profiles override
    this.discoverProfiles(join(config.coreDir, "profiles"));
    this.discoverProfiles(join(config.dataDir, "profiles"));

    console.log(
      `[agent-registry] Initialized: ${this.skills.size} skills, ` +
      `${this.extensions.size} extensions, ${this.profiles.size} profiles`,
    );
  }

  /**
   * Resolve a concrete profile for a session.
   *
   * Resolution order:
   *   1. `sessionContext.profile` — direct reference to a registered profile (highest priority)
   *   2. Profile for `${sourceType}.${mode}` (composite key)
   *   3. Profile for `${sourceType}` (type-level default)
   *   4. `_default` profile (global fallback)
   *
   * After the base profile is found, SessionContext overrides are applied:
   *   - SessionContext.skills replaces the profile's skills list.
   *   - SessionContext.model overrides the profile's model.
   */
  resolveProfile(
    sourceType: string,
    mode?: string,
    sessionContext?: SessionContext,
  ): ResolvedProfile {
    // 1. Direct profile reference from SessionContext (highest priority)
    let profile: SessionProfile | undefined;
    let resolvedFrom: string;

    if (sessionContext?.profile && this.profiles.has(sessionContext.profile)) {
      profile = this.profiles.get(sessionContext.profile)!;
      resolvedFrom = sessionContext.profile;
    } else {
      // 2–4. Standard fallback chain: sourceType.mode → sourceType → _default
      const profileKey = mode ? `${sourceType}.${mode}` : sourceType;
      profile =
        this.profiles.get(profileKey) ??
        this.profiles.get(sourceType) ??
        this.profiles.get("_default")!;
      resolvedFrom =
        this.profiles.has(profileKey)
          ? profileKey
          : this.profiles.has(sourceType)
            ? sourceType
            : "_default";
    }

    // Apply SessionContext overrides
    const effectiveSkills = sessionContext?.skills?.length
      ? sessionContext.skills
      : profile.skills;
    const effectiveModel = sessionContext?.model ?? profile.model;

    // Resolve names → paths
    const skillPaths = this.resolveSkillPaths(effectiveSkills);
    const extensionPaths = this.resolveExtensionPaths(profile.extensions);

    return {
      ...profile,
      skills: effectiveSkills,
      model: effectiveModel,
      resolvedFrom,
      skillPaths,
      extensionPaths,
    };
  }

  /**
   * Validate that all profiles reference existing skills and extensions.
   */
  validate(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const [key, profile] of this.profiles) {
      for (const skill of profile.skills) {
        if (!this.skills.has(skill)) {
          errors.push(`Profile "${key}" references unknown skill "${skill}"`);
        }
      }
      for (const ext of profile.extensions) {
        if (!this.extensions.has(ext)) {
          errors.push(`Profile "${key}" references unknown extension "${ext}"`);
        }
      }
    }

    // Warn about unused skills/extensions
    const usedSkills = new Set<string>();
    const usedExtensions = new Set<string>();
    for (const profile of this.profiles.values()) {
      profile.skills.forEach((s) => usedSkills.add(s));
      profile.extensions.forEach((e) => usedExtensions.add(e));
    }
    for (const name of this.skills.keys()) {
      if (!usedSkills.has(name)) {
        warnings.push(`Skill "${name}" is registered but not used by any profile`);
      }
    }
    for (const name of this.extensions.keys()) {
      if (!usedExtensions.has(name)) {
        warnings.push(`Extension "${name}" is registered but not used by any profile`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // --- Accessors for introspection ---

  getSkills(): SkillEntry[] {
    return [...this.skills.values()];
  }

  getExtensions(): ExtensionEntry[] {
    return [...this.extensions.values()];
  }

  getProfiles(): Map<string, SessionProfile> {
    return new Map(this.profiles);
  }

  getSkill(name: string): SkillEntry | undefined {
    return this.skills.get(name);
  }

  getExtension(name: string): ExtensionEntry | undefined {
    return this.extensions.get(name);
  }

  // --- Private discovery helpers ---

  /**
   * Scan a directory for skill subdirectories.
   * Each subdirectory containing a SKILL.md is registered.
   */
  private discoverSkills(dir: string, source: "core" | "user"): void {
    if (!existsSync(dir)) return;
    try {
      for (const name of readdirSync(dir)) {
        const skillPath = join(dir, name);
        try {
          if (!statSync(skillPath).isDirectory()) continue;
          if (!existsSync(join(skillPath, "SKILL.md"))) {
            // Also accept directories without SKILL.md — Pi SDK skills
            // might use different structures. Log but still register.
          }
          // User overrides core (replace if same name)
          if (source === "user" || !this.skills.has(name)) {
            this.skills.set(name, { name, path: skillPath, source });
          }
        } catch {
          // Skip unreadable entries
        }
      }
    } catch {
      // Directory unreadable
    }
  }

  /**
   * Scan a directory for extension subdirectories.
   * Each subdirectory containing index.ts or index.js is registered.
   */
  private discoverExtensions(dir: string, source: "core" | "user"): void {
    if (!existsSync(dir)) return;
    try {
      for (const name of readdirSync(dir)) {
        const extPath = join(dir, name);
        try {
          if (!statSync(extPath).isDirectory()) continue;
          if (
            !existsSync(join(extPath, "index.ts")) &&
            !existsSync(join(extPath, "index.js"))
          ) {
            continue;
          }
          // User overrides core
          if (source === "user" || !this.extensions.has(name)) {
            this.extensions.set(name, { name, path: extPath, source });
          }
        } catch {
          // Skip unreadable entries
        }
      }
    } catch {
      // Directory unreadable
    }
  }

  /**
   * Resolve skill names to absolute paths.
   * Unknown skills are logged and skipped.
   */
  private resolveSkillPaths(names: string[]): string[] {
    const paths: string[] = [];
    for (const name of names) {
      const entry = this.skills.get(name);
      if (entry) {
        paths.push(entry.path);
      } else {
        console.warn(`[agent-registry] Skill "${name}" not found — skipping`);
      }
    }
    return paths;
  }

  /**
   * Resolve extension names to absolute paths.
   * Unknown extensions are logged and skipped.
   */
  private resolveExtensionPaths(names: string[]): string[] {
    const paths: string[] = [];
    for (const name of names) {
      const entry = this.extensions.get(name);
      if (entry) {
        paths.push(entry.path);
      } else {
        console.warn(`[agent-registry] Extension "${name}" not found — skipping`);
      }
    }
    return paths;
  }

  /**
   * Scan a directory for session profile YAML files.
   * Each .yml/.yaml file is parsed, validated against profileSchema, and registered.
   */
  private discoverProfiles(dir: string): void {
    if (!existsSync(dir)) return;
    try {
      for (const file of readdirSync(dir)) {
        if (!/\.ya?ml$/i.test(file)) continue;
        const filePath = join(dir, file);
        try {
          if (!statSync(filePath).isFile()) continue;
          const raw = readFileSync(filePath, "utf-8");
          const data = yaml.load(raw);

          const result = profileSchema.safeParse(data);
          if (!result.success) {
            const issues = result.error.issues
              .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
              .join("\n");
            console.warn(`[agent-registry] Profile ${file} — validation failed:\n${issues}`);
            continue;
          }

          const parsed = result.data;
          const profile: SessionProfile = {
            label: parsed.label ?? parsed.name,
            skills: parsed.skills,
            extensions: parsed.extensions,
            excludeTools: parsed.exclude_tools,
            ...(parsed.description ? { description: parsed.description } : {}),
            ...(parsed.model ? { model: parsed.model } : {}),
            // sourceType: explicit field, or derived from name prefix (e.g. "book.reading" → "book")
            sourceType: parsed.source_type ?? (parsed.name.includes(".") ? parsed.name.split(".")[0] : undefined),
          };

          this.profiles.set(parsed.name, profile);
          console.log(`[agent-registry] Loaded profile "${parsed.name}" from ${file}`);
        } catch (err) {
          console.warn(`[agent-registry] Failed to parse profile ${file}:`, err);
        }
      }
    } catch {
      // Directory unreadable
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _registry: AgentRegistry | null = null;

/**
 * Get the global AgentRegistry singleton.
 * Must be initialized via `initAgentRegistry()` before first use.
 */
export function getAgentRegistry(): AgentRegistry {
  if (!_registry) {
    throw new Error("AgentRegistry not initialized — call initAgentRegistry() at startup");
  }
  return _registry;
}

/**
 * Initialize the global AgentRegistry singleton.
 * Called once during server startup.
 */
export function initAgentRegistry(config: AgentRegistryConfig): AgentRegistry {
  _registry = new AgentRegistry();
  _registry.initialize(config);

  const validation = _registry.validate();
  if (validation.errors.length) {
    console.error(`[agent-registry] Validation errors:`);
    for (const err of validation.errors) console.error(`  ✗ ${err}`);
  }
  if (validation.warnings.length) {
    console.warn(`[agent-registry] Warnings:`);
    for (const warn of validation.warnings) console.warn(`  ⚠ ${warn}`);
  }

  return _registry;
}
