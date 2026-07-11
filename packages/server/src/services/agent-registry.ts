import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

// ---------------------------------------------------------------------------
// Plugin file resolution — prefer compiled dist/ over source .ts
// ---------------------------------------------------------------------------

/**
 * Resolve a plugin-relative file path, preferring the compiled version in dist/.
 * In production (Docker), plain `node` can't import .ts files, so we resolve to
 * the compiled .js in dist/. In dev mode (tsx), always use the source file so
 * hot-reload works even if a stale dist/ directory exists from a previous build.
 */
function resolvePluginFile(pluginDir: string, relPath: string): string {
  if (process.env.NODE_ENV !== "production") {
    return join(pluginDir, relPath);
  }
  const compiled = join(pluginDir, "dist", relPath.replace(/\.ts$/, ".js"));
  if (existsSync(compiled)) return compiled;
  return join(pluginDir, relPath);
}
import yaml from "js-yaml";
import { z } from "zod";
import type { SessionContext } from "@pi-tree/shared";
import { validatePluginManifest } from "./manifest-schema.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("agent-registry");
import type {
  SkillEntry,
  ExtensionEntry,
  SessionProfile,
  ResolvedProfile,
  AgentRegistryConfig,
  ValidationResult,
  PluginRouteEntry,
  SourceTypeEntry,
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
  /** Lucide icon name for UI display (e.g. "book-open") */
  icon: z.string().optional(),
  /** First message template — {sourceTitle} is interpolated at runtime */
  defaultPrompt: z.string().optional(),
  /** Default title template — {sourceTitle} and {date} interpolated. Used when AI creates a session without a specific title. */
  defaultTitle: z.string().optional(),
  /** Quick-action buttons shown in the session UI */
  quickActions: z.array(z.object({
    label: z.string(),
    icon: z.string(),
    prompt: z.string(),
    /** If set, shows a text input before sending */
    inputPlaceholder: z.string().optional(),
    /** Session title template — {input} and {date} interpolated */
    titleTemplate: z.string().optional(),
  })).optional(),
  /** Display order in the UI (lower = first). Defaults to 100. */
  order: z.number().int().default(100),
  /** If true, this profile is internal and should not appear in the session picker UI. */
  hidden: z.boolean().default(false),
});

export type ProfileYaml = z.infer<typeof profileSchema>;

// ---------------------------------------------------------------------------
// AgentRegistry — discovery, validation, and profile resolution
// ---------------------------------------------------------------------------

export class AgentRegistry {
  private skills = new Map<string, SkillEntry>();
  private extensions = new Map<string, ExtensionEntry>();
  private profiles = new Map<string, SessionProfile>();
  private pluginRoutes = new Map<string, PluginRouteEntry>();
  private sourceTypes = new Map<string, SourceTypeEntry>();

  /**
   * Initialize the registry: scan directories and populate maps.
   * Called once at server startup.
   *
   * Discovery order:
   *   1. Core plugins from corePluginDirs (each dir is processed for extensions,
   *      skills, profiles, routes, and source types)
   *   1b. Server-bundled extensions from coreDir/agents/extensions/
   *   2. Core skills from coreDir/agents/skills/ (legacy standalone, backward compat)
   *   3. User extensions from dataDir/extensions/ (also scanned for bundled pi.skills)
   *   4. User skills from dataDir/skills/
   *   5. Core profiles from coreDir/profiles/
   *   6. User profiles from dataDir/profiles/
   */
  initialize(config: AgentRegistryConfig): void {
    this.skills.clear();
    this.extensions.clear();
    this.profiles.clear();
    this.sourceTypes.clear();

    // --- Discover core plugins (individual plugin directories) ---
    if (config.corePluginDirs?.length) {
      for (const pluginDir of config.corePluginDirs) {
        try {
          this.registerPluginDir(pluginDir, "core");
        } catch (err) {
          if (err instanceof Error && err.message.includes("Route prefix collision")) throw err;
          log.error(`Failed to load plugin from ${pluginDir}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    // Server-bundled extensions (e.g. router) — always scanned
    const serverExtDir = join(config.coreDir, "agents", "extensions");
    this.discoverExtensions(serverExtDir, "core");

    // User extensions
    this.discoverExtensions(join(config.dataDir, "extensions"), "user");
    if (config.extensionsPath) {
      this.discoverExtensions(config.extensionsPath, "user");
    }

    // --- Discover skills ---
    // Skills bundled inside server-bundled extensions
    this.discoverSkills(serverExtDir, "core");

    // Standalone core skills (legacy path — kept for backward compat, harmless no-op if empty)
    this.discoverSkills(join(config.coreDir, "agents", "skills"), "core");

    // User skills: bundled in user extensions, then standalone user skills
    this.discoverSkills(join(config.dataDir, "extensions"), "user");
    if (config.extensionsPath) {
      this.discoverSkills(config.extensionsPath, "user");
    }
    this.discoverSkills(join(config.dataDir, "skills"), "user");
    if (config.skillsPath) {
      this.discoverSkills(config.skillsPath, "user");
    }

    // --- Load profiles ---
    // Server-bundled profiles
    this.discoverPluginProfiles(serverExtDir);

    // Legacy core profiles path (kept for backward compat)
    this.discoverProfiles(join(config.coreDir, "profiles"));

    // User plugin profiles, then standalone user profiles
    this.discoverPluginProfiles(join(config.dataDir, "extensions"));
    if (config.extensionsPath) {
      this.discoverPluginProfiles(config.extensionsPath);
    }
    this.discoverProfiles(join(config.dataDir, "profiles"));

    // --- Discover plugin routes (server-bundled + user) ---
    this.discoverPluginRoutes(serverExtDir);
    this.discoverPluginRoutes(join(config.dataDir, "extensions"));
    if (config.extensionsPath) {
      this.discoverPluginRoutes(config.extensionsPath);
    }

    // --- Discover source types (server-bundled + user) ---
    this.discoverSourceTypes(serverExtDir);
    this.discoverSourceTypes(join(config.dataDir, "extensions"));
    if (config.extensionsPath) {
      this.discoverSourceTypes(config.extensionsPath);
    }

    log.info(
      `Initialized: ${this.skills.size} skills, ` +
      `${this.extensions.size} extensions, ${this.profiles.size} profiles, ` +
      `${this.pluginRoutes.size} plugin routes, ${this.sourceTypes.size} source types`,
    );
  }

  /**
   * Resolve a concrete profile for a session.
   *
   * Resolution order:
   *   1. `sessionContext.profile` — direct reference to a registered profile (highest priority)
   *   2. Profile for `${sourceType}.${mode}` (composite key)
   *   3. Profile for `${sourceType}` (direct key, e.g. "router")
   *   4. Profile for `${mode}` alone (source-type-agnostic profiles, e.g. "concept-extraction")
   *
   * No implicit fallback — every source type + mode combination must have an
   * explicit profile YAML. The `_default` profile is only used when explicitly
   * referenced via `sessionContext.profile`.
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
      // 2–4. Strict lookup: sourceType.mode → sourceType → mode (no fallback)
      const profileKey = mode ? `${sourceType}.${mode}` : sourceType;
      profile = this.profiles.get(profileKey)
        ?? this.profiles.get(sourceType)
        ?? (mode ? this.profiles.get(mode) : undefined);
      if (!profile) {
        throw new Error(
          `No profile found for '${profileKey}'. ` +
          `Plugin must declare a profile YAML for each source type + mode combination.`,
        );
      }
      resolvedFrom = this.profiles.has(profileKey)
        ? profileKey
        : this.profiles.has(sourceType)
          ? sourceType
          : mode!;
    }

    // Apply SessionContext overrides
    const effectiveSkills = sessionContext?.skills?.length
      ? sessionContext.skills
      : profile.skills;
    const effectiveExtensions = sessionContext?.extensions?.length
      ? sessionContext.extensions
      : profile.extensions;
    const effectiveModel = sessionContext?.model ?? profile.model;

    // Expand wildcard: "*" → all registered extension names
    const resolvedExtensions = effectiveExtensions.includes("*")
      ? [...this.extensions.keys()]
      : effectiveExtensions;

    // Resolve names → paths
    const skillPaths = this.resolveSkillPaths(effectiveSkills);
    const extensionPaths = this.resolveExtensionPaths(resolvedExtensions);

    return {
      ...profile,
      skills: effectiveSkills,
      extensions: effectiveExtensions,
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
        if (ext === "*") continue; // wildcard — resolved at runtime
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

  getPluginRoutes(): PluginRouteEntry[] {
    return [...this.pluginRoutes.values()];
  }

  getSourceTypes(): SourceTypeEntry[] {
    return [...this.sourceTypes.values()];
  }

  /**
   * Build a SourceTypeEntry from a piTree.sourceType manifest section.
   * Extracted to avoid duplicating the 20+ field mapping in two places.
   */
  private buildSourceTypeEntry(
    st: Record<string, any>,
    pluginName: string,
    pluginDir: string,
    hasUI: boolean,
  ): SourceTypeEntry {
    return {
      key: st.key,
      label: st.label ?? st.key,
      icon: st.icon ?? "puzzle",
      sessionModes: st.sessionModes ?? ["reading", "custom"],
      defaultMode: st.defaultMode ?? "reading",
      autoStartMode: st.autoStartMode,
      hasProcessing: st.hasProcessing ?? false,
      finishable: st.finishable ?? true,
      concepts: st.concepts ?? false,
      searchPlaceholder: st.searchPlaceholder,
      chatPlaceholder: st.chatPlaceholder,
      mentionKeyword: st.mentionKeyword,
      fixedSourceId: st.fixedSourceId,
      sessionStrategy: st.sessionStrategy,
      askAfterHours: st.askAfterHours,
      staleAfterHours: st.staleAfterHours,
      routingContextFile: st.routingContextFile,
      routingContextLabel: st.routingContextLabel,
      tagGroupsFile: st.tagGroupsFile,
      addSource: st.addSource,
      cardSubtitle: st.cardSubtitle,
      badges: st.badges,
      systemContext: st.systemContext,
      tagPromptTemplate: st.tagPromptTemplate,
      qualifierPromptTemplate: st.qualifierPromptTemplate,
      pluginName,
      hasUI,
      pluginDir,
    };
  }

  /**
   * Check for route prefix collisions before registering a new plugin route.
   * Throws if another plugin already registered the same prefix.
   */
  private checkRoutePrefixCollision(name: string, prefix: string): void {
    for (const existing of this.pluginRoutes.values()) {
      if (existing.prefix === prefix && existing.name !== name) {
        throw new Error(
          `Route prefix collision: plugin "${name}" wants prefix "${prefix}" ` +
          `but plugin "${existing.name}" already registered it. ` +
          `Set a unique "routePrefix" in one of the plugins' package.json piTree field.`,
        );
      }
    }
  }

  // --- Private discovery helpers ---

  /**
   * Process a single plugin directory for all discovery phases:
   * extensions, skills, profiles, routes, and source types.
   * Used for core plugins that live as individual directories.
   */
  private registerPluginDir(pluginDir: string, source: "core" | "user"): void {
    if (!existsSync(pluginDir)) return;
    try {
      if (!statSync(pluginDir).isDirectory()) return;
    } catch { return; }

    // Extensions: check for Pi package format (package.json with pi.extensions)
    const pkgJsonPath = join(pluginDir, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

        // Derive plugin name from package.json `name` field (strip "pi-tree-" prefix)
        // to preserve backward-compatible names (e.g. "book" not "plugin-book").
        // Falls back to directory basename if no package name.
        const rawName: string = pkg.name ?? pluginDir.split(/[\/\\]/).pop() ?? pluginDir;
        const name = rawName.replace(/^pi-tree-/, "");

        // Validate manifest (piTree + pi fields)
        if (pkg.piTree || pkg.pi) {
          const validation = validatePluginManifest(pkg, name);
          for (const err of validation.errors) {
            log.error(`Manifest error: ${err}`);
          }
          for (const warn of validation.warnings) {
            log.warn(`Manifest warning: ${warn}`);
          }
        }

        // Register extension
        if (pkg.pi?.extensions?.length) {
          if (source === "user" || !this.extensions.has(name)) {
            this.extensions.set(name, { name, path: pluginDir, source });
          }
        }

        // Register skills from pi.skills
        if (pkg.pi?.skills?.length) {
          for (const skillDir of pkg.pi.skills as string[]) {
            const resolvedSkillDir = join(pluginDir, skillDir);
            this.discoverSkills(resolvedSkillDir, source);
          }
        }

        // Register profiles from profiles/ subdir
        const profilesDir = join(pluginDir, "profiles");
        if (existsSync(profilesDir)) {
          this.discoverProfiles(profilesDir);
        }

        // Register routes from piTree.routes
        const routesRelPath = pkg.piTree?.routes;
        if (routesRelPath && !this.pluginRoutes.has(name)) {
          const routesPath = resolvePluginFile(pluginDir, routesRelPath);
          const prefix = pkg.piTree?.routePrefix ?? `/api/${name}`;
          this.checkRoutePrefixCollision(name, prefix);
          this.pluginRoutes.set(name, { name, routesPath, prefix });
          log.info(`Discovered plugin routes: ${name} → ${prefix}`);
        }

        // Register source types from piTree.sourceType + piTree.sourceTypes
        for (const st of [pkg.piTree?.sourceType, ...(pkg.piTree?.sourceTypes ?? [])]) {
          if (st?.key && !this.sourceTypes.has(st.key)) {
            this.sourceTypes.set(st.key, this.buildSourceTypeEntry(st, name, pluginDir, !!pkg.piTree?.ui));
            log.info(`Discovered source type "${st.key}" from plugin ${name}`);
          }
        }
      } catch (err: any) {
        if (err?.message?.includes("Route prefix collision")) throw err;
        log.error(`Failed to read plugin package.json in ${pluginDir}:`, err?.message ?? err);
      }
    } else {
      // Fallback: directory with index.ts/index.js (no package.json)
      const name = pluginDir.split(/[\/\\]/).pop() ?? pluginDir;
      if (existsSync(join(pluginDir, "index.ts")) || existsSync(join(pluginDir, "index.js"))) {
        if (source === "user" || !this.extensions.has(name)) {
          this.extensions.set(name, { name, path: pluginDir, source });
        }
      }
    }
  }

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

          // Pi package format: package.json with pi.skills
          const pkgJsonPath = join(skillPath, "package.json");
          if (existsSync(pkgJsonPath)) {
            try {
              const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
              if (pkg.pi?.skills?.length) {
                // Scan each declared skill path within the package
                for (const skillDir of pkg.pi.skills as string[]) {
                  const resolvedSkillDir = join(skillPath, skillDir);
                  this.discoverSkills(resolvedSkillDir, source);
                }
                continue;
              }
            } catch (err: any) {
              log.error(`Invalid package.json in skill ${skillPath}:`, err?.message ?? err);
            }
          }

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
   * Recognizes two formats:
   *   1. Pi package: directory with package.json containing pi.extensions
   *   2. Convention: directory with index.ts or index.js
   */
  private discoverExtensions(dir: string, source: "core" | "user"): void {
    if (!existsSync(dir)) return;
    try {
      for (const name of readdirSync(dir)) {
        const extPath = join(dir, name);
        try {
          if (!statSync(extPath).isDirectory()) continue;

          // Pi package format: package.json with pi.extensions
          const pkgJsonPath = join(extPath, "package.json");
          if (existsSync(pkgJsonPath)) {
            try {
              const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
              if (pkg.pi?.extensions?.length) {
                // Register as a Pi package — ResourceLoader handles the manifest
                if (source === "user" || !this.extensions.has(name)) {
                  this.extensions.set(name, { name, path: extPath, source });
                }
                continue; // Don't also check for index.ts
              }
            } catch (err: any) {
              log.error(`Invalid package.json in extension ${extPath}:`, err?.message ?? err);
            }
          }

          // Current format: index.ts or index.js directly
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
        log.warn(`Skill "${name}" not found — skipping`);
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
        log.warn(`Extension "${name}" not found — skipping`);
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
            log.warn(`Profile ${file} — validation failed:\n${issues}`);
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
            ...(parsed.icon ? { icon: parsed.icon } : {}),
            ...(parsed.defaultPrompt ? { defaultPrompt: parsed.defaultPrompt } : {}),
            ...(parsed.defaultTitle ? { defaultTitle: parsed.defaultTitle } : {}),
            ...(parsed.quickActions ? { quickActions: parsed.quickActions } : {}),
            order: parsed.order,
            ...(parsed.hidden ? { hidden: true } : {}),
          };

          this.profiles.set(parsed.name, profile);
          log.info(`Loaded profile "${parsed.name}" from ${file}`);
        } catch (err) {
          log.error(`Failed to parse profile ${file}:`, err);
        }
      }
    } catch {
      // Directory unreadable
    }
  }
  /**
   * Scan a directory of plugins for bundled profiles.
   * Each subdirectory may contain a profiles/ dir with YAML files.
   */
  private discoverPluginProfiles(dir: string): void {
    if (!existsSync(dir)) return;
    try {
      for (const name of readdirSync(dir)) {
        const pluginDir = join(dir, name);
        try {
          if (!statSync(pluginDir).isDirectory()) continue;
          const profilesDir = join(pluginDir, "profiles");
          if (existsSync(profilesDir)) {
            this.discoverProfiles(profilesDir);
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
   * Scan a directory of plugins for route modules.
   * Each subdirectory may contain a package.json with piTree.routes.
   */
  private discoverPluginRoutes(dir: string): void {
    if (!existsSync(dir)) return;
    try {
      for (const name of readdirSync(dir)) {
        const pluginDir = join(dir, name);
        try {
          if (!statSync(pluginDir).isDirectory()) continue;
          // Already discovered
          if (this.pluginRoutes.has(name)) continue;

          const pkgJsonPath = join(pluginDir, "package.json");
          if (!existsSync(pkgJsonPath)) continue;

          const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

          // Validate manifest
          const validation = validatePluginManifest(pkg, name);
          for (const err of validation.errors) {
            log.error(`Manifest error: ${err}`);
          }

          const routesRelPath = pkg.piTree?.routes;
          if (!routesRelPath) continue;

          const routesPath = resolvePluginFile(pluginDir, routesRelPath);
          const prefix = pkg.piTree?.routePrefix ?? `/api/${name}`;
          this.checkRoutePrefixCollision(name, prefix);

          this.pluginRoutes.set(name, { name, routesPath, prefix });
          log.info(`Discovered plugin routes: ${name} → ${prefix}`);
        } catch (err: any) {
          if (err?.message?.includes("Route prefix collision")) throw err;
          log.error(`Failed to read plugin in ${pluginDir}:`, err?.message ?? err);
        }
      }
    } catch {
      // Directory unreadable
    }
  }

  /**
   * Scan a directory of plugins for source type manifests.
   * Each subdirectory may contain a package.json with piTree.sourceType.
   */
  private discoverSourceTypes(dir: string): void {
    if (!existsSync(dir)) return;
    try {
      for (const name of readdirSync(dir)) {
        const pluginDir = join(dir, name);
        try {
          if (!statSync(pluginDir).isDirectory()) continue;
          const pkgJsonPath = join(pluginDir, "package.json");
          if (!existsSync(pkgJsonPath)) continue;

          const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

          // Validate manifest
          const validation = validatePluginManifest(pkg, name);
          for (const err of validation.errors) {
            log.error(`Manifest error: ${err}`);
          }

          for (const st of [pkg.piTree?.sourceType, ...(pkg.piTree?.sourceTypes ?? [])]) {
            if (!st?.key) continue;

            // Don't override if already discovered (first wins = core)
            if (this.sourceTypes.has(st.key)) continue;

            this.sourceTypes.set(st.key, this.buildSourceTypeEntry(st, name, pluginDir, !!pkg.piTree?.ui));
            log.info(`Discovered source type "${st.key}" from plugin ${name}`);
          }
        } catch (err: any) {
          log.error(`Failed to read plugin in ${pluginDir}:`, err?.message ?? err);
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
    log.error("Validation errors:");
    for (const err of validation.errors) log.error(` ${err}`);
  }
  if (validation.warnings.length) {
    log.warn("Warnings:");
    for (const warn of validation.warnings) log.warn(` ${warn}`);
  }

  return _registry;
}
