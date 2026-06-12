/**
 * Tests for AgentRegistry — discovery, validation, and profile resolution.
 *
 * Critical paths tested:
 * 1. Skill/extension discovery from core + user directories
 * 2. User overrides core (first-wins dedup by name)
 * 3. Profile resolution: sourceType.mode → sourceType → _default
 * 4. SessionContext overrides (skills, model)
 * 5. Validation: missing skills/extensions, unused entries
 * 6. Edge cases: empty dirs, missing dirs, unknown profiles
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentRegistry } from "../agent-registry.js";
import type { AgentRegistryConfig } from "../../types/agent.js";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_ROOT = mkdtempSync(join(tmpdir(), "agent-registry-test-"));

/** Create a mock skill directory with a SKILL.md */
function createSkill(baseDir: string, name: string, content = "# Skill"): string {
  const dir = join(baseDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
  return dir;
}

/** Create a mock extension directory with an index.ts */
function createExtension(baseDir: string, name: string, content = "export default function() {}"): string {
  const dir = join(baseDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.ts"), content);
  return dir;
}

/** Create a mock YAML profile file */
function createProfile(baseDir: string, filename: string, content: string): string {
  mkdirSync(baseDir, { recursive: true });
  const filePath = join(baseDir, filename);
  writeFileSync(filePath, content);
  return filePath;
}

/** Seed the core profiles that built-in resolution tests depend on */
function seedCoreProfiles(profilesDir: string): void {
  createProfile(profilesDir, "book-reading.yml", "name: book.reading\nlabel: Book Reading\nskills: [interactive-reading]\nextensions: [mcp]\nexclude_tools: [bash, edit]\n");
  createProfile(profilesDir, "book-qa.yml", "name: book.qa\nlabel: Book Q&A\nskills: [interactive-reading]\nextensions: [mcp]\nexclude_tools: [bash, edit]\n");
  createProfile(profilesDir, "book-analysis.yml", "name: book.analysis\nlabel: Book Analysis\nskills: [book-analysis, book-outline]\nextensions: [mcp]\nexclude_tools: [bash, edit]\n");
  createProfile(profilesDir, "book.yml", "name: book\nlabel: Book (Default)\nskills: [interactive-reading]\nextensions: [mcp]\nexclude_tools: [bash, edit]\n");
  createProfile(profilesDir, "news-reading.yml", "name: news.news\nlabel: News Reading\nskills: [news-reading]\nextensions: [news, mcp]\nexclude_tools: [bash, edit]\n");
  createProfile(profilesDir, "news.yml", "name: news\nlabel: News (Default)\nskills: [news-reading]\nextensions: [news, mcp]\nexclude_tools: [bash, edit]\n");
  createProfile(profilesDir, "paper-reading.yml", "name: paper.reading\nlabel: Paper Reading\nskills: [paper-reading]\nextensions: [paper, mcp]\nexclude_tools: [bash, edit]\n");
  createProfile(profilesDir, "paper.yml", "name: paper\nlabel: Paper (Default)\nskills: [paper-reading]\nextensions: [paper, mcp]\nexclude_tools: [bash, edit]\n");
  createProfile(profilesDir, "router.yml", "name: router\nlabel: Session Router\nskills: [session-router]\nextensions: [library]\nexclude_tools: [bash, edit]\n");
  createProfile(profilesDir, "default.yml", "name: _default\nlabel: Default\nskills: [interactive-reading]\nextensions: [mcp]\nexclude_tools: [bash, edit]\n");
}

/**
 * Build a test config pointing at temp directories.
 *
 * Layout mirrors the real server layout:
 *   <root>/core/agents/skills/      — core skills
 *   <root>/core/agents/extensions/  — core extensions
 *   <root>/core/profiles/           — core profiles (YAML)
 *   <root>/data/skills/             — user skill overrides
 *   <root>/data/extensions/         — user extension overrides
 *   <root>/data/profiles/           — user-defined profiles
 */
function makeConfig(suffix: string) {
  const coreDir = join(TEST_ROOT, suffix, "core");
  const dataDir = join(TEST_ROOT, suffix, "data");
  // Core subdirs
  const coreSkillsDir = join(coreDir, "agents", "skills");
  const coreExtDir = join(coreDir, "agents", "extensions");
  const coreProfilesDir = join(coreDir, "profiles");
  // User subdirs
  const userSkillsDir = join(dataDir, "skills");
  const userExtDir = join(dataDir, "extensions");
  const userProfilesDir = join(dataDir, "profiles");
  // Create all
  for (const d of [coreSkillsDir, coreExtDir, coreProfilesDir, userSkillsDir, userExtDir, userProfilesDir]) {
    mkdirSync(d, { recursive: true });
  }
  return {
    // AgentRegistryConfig fields
    coreDir,
    dataDir,
    // Convenience accessors for tests
    coreSkillsDir,
    coreExtDir,
    coreProfilesDir,
    userSkillsDir,
    userExtDir,
    userProfilesDir,
  };
}

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("AgentRegistry", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  // --- Discovery ---

  describe("discovery", () => {
    it("discovers skills from core directory", () => {
      const cfg = makeConfig("disc-skills");
      createSkill(cfg.coreSkillsDir, "interactive-reading");
      createSkill(cfg.coreSkillsDir, "book-outline");

      registry.initialize(cfg);

      const skills = registry.getSkills();
      expect(skills).toHaveLength(2);
      expect(skills.map((s) => s.name).sort()).toEqual(["book-outline", "interactive-reading"]);
      expect(skills.every((s) => s.source === "core")).toBe(true);
    });

    it("discovers extensions from core directory", () => {
      const cfg = makeConfig("disc-ext");
      createExtension(cfg.coreExtDir, "library");
      createExtension(cfg.coreExtDir, "news");

      registry.initialize(cfg);

      const extensions = registry.getExtensions();
      expect(extensions).toHaveLength(2);
      expect(extensions.map((e) => e.name).sort()).toEqual(["library", "news"]);
      expect(extensions.every((e) => e.source === "core")).toBe(true);
    });

    it("user skills override core skills with same name", () => {
      const cfg = makeConfig("disc-override-skill");
      createSkill(cfg.coreSkillsDir, "interactive-reading", "# Core version");
      createSkill(cfg.userSkillsDir, "interactive-reading", "# User version");

      registry.initialize(cfg);

      const skills = registry.getSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("interactive-reading");
      expect(skills[0].source).toBe("user");
      expect(skills[0].path).toContain(join("data", "skills"));
    });

    it("user extensions override core extensions with same name", () => {
      const cfg = makeConfig("disc-override-ext");
      createExtension(cfg.coreExtDir, "news", "// core");
      createExtension(cfg.userExtDir, "news", "// user override");

      registry.initialize(cfg);

      const extensions = registry.getExtensions();
      expect(extensions).toHaveLength(1);
      expect(extensions[0].name).toBe("news");
      expect(extensions[0].source).toBe("user");
      expect(extensions[0].path).toContain(join("data", "extensions"));
    });

    it("merges core and user skills (different names)", () => {
      const cfg = makeConfig("disc-merge");
      createSkill(cfg.coreSkillsDir, "interactive-reading");
      createSkill(cfg.userSkillsDir, "my-custom-skill");

      registry.initialize(cfg);

      const skills = registry.getSkills();
      expect(skills).toHaveLength(2);
      const names = skills.map((s) => s.name).sort();
      expect(names).toEqual(["interactive-reading", "my-custom-skill"]);
    });

    it("ignores non-directory entries", () => {
      const cfg = makeConfig("disc-ignore-files");
      createSkill(cfg.coreSkillsDir, "real-skill");
      // Create a file (not directory) in the skills dir
      writeFileSync(join(cfg.coreSkillsDir, "README.md"), "not a skill");

      registry.initialize(cfg);

      const skills = registry.getSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("real-skill");
    });

    it("skips extensions without index.ts or index.js", () => {
      const cfg = makeConfig("disc-skip-no-index");
      createExtension(cfg.coreExtDir, "valid-ext");
      // Create a directory without index file
      const badDir = join(cfg.coreExtDir, "no-index-ext");
      mkdirSync(badDir, { recursive: true });
      writeFileSync(join(badDir, "helpers.ts"), "// not an extension entry point");

      registry.initialize(cfg);

      const extensions = registry.getExtensions();
      expect(extensions).toHaveLength(1);
      expect(extensions[0].name).toBe("valid-ext");
    });

    it("handles missing directories gracefully", () => {
      const cfg = makeConfig("disc-missing-dirs");
      // Don't create any subdirectories — just use empty parent dirs
      // (the parent dirs exist but have no skill/extension subdirs)

      registry.initialize(cfg);

      expect(registry.getSkills()).toHaveLength(0);
      expect(registry.getExtensions()).toHaveLength(0);
    });

    it("handles nonexistent directories gracefully", () => {
      registry.initialize({
        coreDir: "/tmp/nonexistent-dir-12345",
        dataDir: "/tmp/also-nonexistent-67890",
      });

      expect(registry.getSkills()).toHaveLength(0);
      expect(registry.getExtensions()).toHaveLength(0);
    });
  });

  // --- Profile resolution ---

  describe("resolveProfile", () => {
    /** Set up a registry with realistic skills and extensions */
    function setupRealisticRegistry() {
      const cfg = makeConfig(`resolve-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      seedCoreProfiles(cfg.coreProfilesDir);
      createSkill(cfg.coreSkillsDir, "interactive-reading");
      createSkill(cfg.coreSkillsDir, "book-outline");
      createSkill(cfg.coreSkillsDir, "book-analysis");
      createSkill(cfg.coreSkillsDir, "news-reading");
      createSkill(cfg.coreSkillsDir, "paper-reading");
      createSkill(cfg.coreSkillsDir, "session-router");
      createExtension(cfg.coreExtDir, "library");
      createExtension(cfg.coreExtDir, "news");
      createExtension(cfg.coreExtDir, "paper");
      createExtension(cfg.coreExtDir, "mcp");
      registry.initialize(cfg);
      return cfg;
    }

    it("resolves exact sourceType.mode profile", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("book", "reading");

      expect(profile.resolvedFrom).toBe("book.reading");
      expect(profile.skills).toEqual(["interactive-reading"]);
      expect(profile.extensions).toEqual(["mcp"]);
      expect(profile.skillPaths).toHaveLength(1);
      expect(profile.skillPaths[0]).toContain("interactive-reading");
    });

    it("resolves news.news profile with extension", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("news", "news");

      expect(profile.resolvedFrom).toBe("news.news");
      expect(profile.skills).toEqual(["news-reading"]);
      expect(profile.extensions).toEqual(["news", "mcp"]);
      expect(profile.extensionPaths).toHaveLength(2);
      expect(profile.extensionPaths[0]).toContain("news");
    });

    it("resolves router profile (no mode)", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("router");

      expect(profile.resolvedFrom).toBe("router");
      expect(profile.skills).toEqual(["session-router"]);
      expect(profile.extensions).toEqual(["library"]);
    });

    it("falls back to sourceType-level profile when mode not found", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("book", "nonexistent-mode");

      expect(profile.resolvedFrom).toBe("book");
      expect(profile.skills).toEqual(["interactive-reading"]);
    });

    it("falls back to _default when sourceType not found", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("podcast", "custom");

      expect(profile.resolvedFrom).toBe("_default");
      expect(profile.skills).toEqual(["interactive-reading"]);
    });

    it("resolves book.analysis with multiple skills", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("book", "analysis");

      expect(profile.resolvedFrom).toBe("book.analysis");
      expect(profile.skills).toEqual(["book-analysis", "book-outline"]);
      expect(profile.skillPaths).toHaveLength(2);
    });

    it("includes excludeTools from profile", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("book", "reading");

      expect(profile.excludeTools).toEqual(["bash", "edit"]);
    });

    // --- SessionContext overrides ---

    it("SessionContext.skills overrides profile skills", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("book", "reading", {
        mode: "reading",
        skills: ["book-analysis", "book-outline"],
      });

      // Skills come from SessionContext, not the profile
      expect(profile.skills).toEqual(["book-analysis", "book-outline"]);
      expect(profile.skillPaths).toHaveLength(2);
      // But profile key is still resolved from the base
      expect(profile.resolvedFrom).toBe("book.reading");
    });

    it("SessionContext.model overrides profile model", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("book", "reading", {
        mode: "reading",
        model: "gpt-4o-mini",
      });

      expect(profile.model).toBe("gpt-4o-mini");
    });

    it("empty SessionContext.skills does NOT override (uses profile default)", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("book", "reading", {
        mode: "reading",
        skills: [],
      });

      // Empty array should not override
      expect(profile.skills).toEqual(["interactive-reading"]);
    });

    it("undefined SessionContext fields fall through to profile", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("book", "reading", {
        mode: "reading",
      });

      expect(profile.skills).toEqual(["interactive-reading"]);
      expect(profile.model).toBeUndefined();
    });

    // --- Path resolution edge cases ---

    it("unknown skill name in SessionContext produces empty path", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("book", "reading", {
        mode: "reading",
        skills: ["nonexistent-skill"],
      });

      expect(profile.skills).toEqual(["nonexistent-skill"]);
      expect(profile.skillPaths).toHaveLength(0); // not found → skipped
    });

    // --- sessionContext.profile direct resolution ---

    it("resolves profile directly when sessionContext.profile is set", () => {
      const cfg = setupRealisticRegistry();
      // Create a custom profile that doesn't follow sourceType.mode naming
      writeFileSync(
        join(cfg.userProfilesDir, "github-exploration.yml"),
        "name: github-exploration\nlabel: GitHub Exploration\nskills: [interactive-reading]\nextensions: [mcp]\n",
      );
      // Re-initialize to pick up the new profile
      registry.initialize(cfg);

      const profile = registry.resolveProfile("book", "reading", {
        mode: "reading",
        profile: "github-exploration",
      });

      // Should use the directly-referenced profile, not book.reading
      expect(profile.resolvedFrom).toBe("github-exploration");
      expect(profile.label).toBe("GitHub Exploration");
    });

    it("falls back to normal resolution when sessionContext.profile doesn't exist", () => {
      setupRealisticRegistry();

      const profile = registry.resolveProfile("book", "reading", {
        mode: "reading",
        profile: "nonexistent-profile",
      });

      // Should fall back to book.reading
      expect(profile.resolvedFrom).toBe("book.reading");
    });
  });

  // --- Validation ---

  describe("validate", () => {
    it("passes with valid profiles", () => {
      const cfg = makeConfig("valid-profiles");
      seedCoreProfiles(cfg.coreProfilesDir);
      createSkill(cfg.coreSkillsDir, "interactive-reading");
      createSkill(cfg.coreSkillsDir, "book-analysis");
      createSkill(cfg.coreSkillsDir, "book-outline");
      createSkill(cfg.coreSkillsDir, "news-reading");
      createSkill(cfg.coreSkillsDir, "paper-reading");
      createSkill(cfg.coreSkillsDir, "session-router");
      createExtension(cfg.coreExtDir, "library");
      createExtension(cfg.coreExtDir, "news");
      createExtension(cfg.coreExtDir, "paper");
      createExtension(cfg.coreExtDir, "mcp");
      registry.initialize(cfg);

      const result = registry.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("reports errors for missing skills referenced by profiles", () => {
      const cfg = makeConfig("missing-skills");
      seedCoreProfiles(cfg.coreProfilesDir);
      // Only create some skills — profiles reference others that don't exist
      createSkill(cfg.coreSkillsDir, "interactive-reading");
      createExtension(cfg.coreExtDir, "library");
      createExtension(cfg.coreExtDir, "news");
      createExtension(cfg.coreExtDir, "mcp");
      // Missing: book-analysis, book-outline, news-reading, session-router
      registry.initialize(cfg);

      const result = registry.validate();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Should mention specific missing skills
      const errorText = result.errors.join(" ");
      expect(errorText).toContain("book-analysis");
      expect(errorText).toContain("session-router");
      expect(errorText).toContain("news-reading");
    });

    it("reports errors for missing extensions referenced by profiles", () => {
      const cfg = makeConfig("missing-ext");
      seedCoreProfiles(cfg.coreProfilesDir);
      createSkill(cfg.coreSkillsDir, "interactive-reading");
      createSkill(cfg.coreSkillsDir, "book-analysis");
      createSkill(cfg.coreSkillsDir, "book-outline");
      createSkill(cfg.coreSkillsDir, "news-reading");
      createSkill(cfg.coreSkillsDir, "session-router");
      // Missing: library, news extensions
      registry.initialize(cfg);

      const result = registry.validate();

      expect(result.valid).toBe(false);
      const errorText = result.errors.join(" ");
      expect(errorText).toContain("library");
      expect(errorText).toContain("news");
    });

    it("warns about unused skills not referenced by any profile", () => {
      const cfg = makeConfig("unused-skills");
      seedCoreProfiles(cfg.coreProfilesDir);
      createSkill(cfg.coreSkillsDir, "interactive-reading");
      createSkill(cfg.coreSkillsDir, "book-analysis");
      createSkill(cfg.coreSkillsDir, "book-outline");
      createSkill(cfg.coreSkillsDir, "news-reading");
      createSkill(cfg.coreSkillsDir, "paper-reading");
      createSkill(cfg.coreSkillsDir, "session-router");
      createSkill(cfg.userSkillsDir, "orphan-skill"); // not used by any profile
      createExtension(cfg.coreExtDir, "library");
      createExtension(cfg.coreExtDir, "news");
      createExtension(cfg.coreExtDir, "paper");
      createExtension(cfg.coreExtDir, "mcp");
      registry.initialize(cfg);

      const result = registry.validate();

      expect(result.valid).toBe(true); // warnings don't make it invalid
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("orphan-skill"))).toBe(true);
    });
  });

  // --- Introspection ---

  describe("introspection", () => {
    it("getSkill returns entry by name", () => {
      const cfg = makeConfig("intro-skill");
      createSkill(cfg.coreSkillsDir, "interactive-reading");
      registry.initialize(cfg);

      const skill = registry.getSkill("interactive-reading");
      expect(skill).toBeDefined();
      expect(skill!.name).toBe("interactive-reading");
      expect(skill!.source).toBe("core");
    });

    it("getSkill returns undefined for unknown name", () => {
      const cfg = makeConfig("intro-missing");
      registry.initialize(cfg);

      expect(registry.getSkill("nonexistent")).toBeUndefined();
    });

    it("getExtension returns entry by name", () => {
      const cfg = makeConfig("intro-ext");
      createExtension(cfg.coreExtDir, "library");
      registry.initialize(cfg);

      const ext = registry.getExtension("library");
      expect(ext).toBeDefined();
      expect(ext!.name).toBe("library");
    });

    it("getProfiles returns all registered profiles", () => {
      const cfg = makeConfig("intro-profiles");
      seedCoreProfiles(cfg.coreProfilesDir);
      registry.initialize(cfg);

      const profiles = registry.getProfiles();
      expect(profiles.size).toBeGreaterThan(0);
      expect(profiles.has("book.reading")).toBe(true);
      expect(profiles.has("news.news")).toBe(true);
      expect(profiles.has("router")).toBe(true);
      expect(profiles.has("_default")).toBe(true);
    });
  });

  // --- User-defined profiles ---

  describe("user-defined profiles", () => {
    it("discovers valid YAML profiles from user profiles directory", () => {
      const cfg = makeConfig("user-profiles-basic");
      writeFileSync(
        join(cfg.userProfilesDir, "github-exploration.yml"),
        [
          "name: github-exploration",
          "label: GitHub Repo Exploration",
          "description: Explore and research GitHub repositories",
          "skills: [repo-exploration]",
          "extensions: [mcp]",
          "exclude_tools: [edit]",
        ].join("\n"),
      );

      registry.initialize(cfg);

      const profiles = registry.getProfiles();
      expect(profiles.has("github-exploration")).toBe(true);
      const profile = profiles.get("github-exploration")!;
      expect(profile.label).toBe("GitHub Repo Exploration");
      expect(profile.skills).toEqual(["repo-exploration"]);
      expect(profile.extensions).toEqual(["mcp"]);
      expect(profile.excludeTools).toEqual(["edit"]);
    });

    it("rejects profiles missing required 'name' field", () => {
      const cfg = makeConfig("user-profiles-noname");
      writeFileSync(
        join(cfg.userProfilesDir, "bad.yml"),
        "label: Missing Name\nskills: [foo]\n",
      );

      registry.initialize(cfg);

      const profiles = registry.getProfiles();
      expect(profiles.has("Missing Name")).toBe(false);
    });

    it("rejects profiles missing required 'skills' field", () => {
      const cfg = makeConfig("user-profiles-noskills");
      writeFileSync(
        join(cfg.userProfilesDir, "no-skills.yml"),
        "name: no-skills-profile\nlabel: Oops\n",
      );

      registry.initialize(cfg);

      expect(registry.getProfiles().has("no-skills-profile")).toBe(false);
    });

    it("rejects profiles with wrong types (skills as string instead of array)", () => {
      const cfg = makeConfig("user-profiles-wrongtype");
      writeFileSync(
        join(cfg.userProfilesDir, "bad-type.yml"),
        "name: bad-type\nskills: not-an-array\n",
      );

      registry.initialize(cfg);

      expect(registry.getProfiles().has("bad-type")).toBe(false);
    });

    it("rejects profiles with unknown fields (catches typos)", () => {
      const cfg = makeConfig("user-profiles-typo");
      writeFileSync(
        join(cfg.userProfilesDir, "typo.yml"),
        "name: typo-profile\nskills: [foo]\nskill: bar\n",
      );

      registry.initialize(cfg);

      // strictObject rejects unknown keys
      expect(registry.getProfiles().has("typo-profile")).toBe(false);
    });

    it("rejects profiles with non-string items in arrays", () => {
      const cfg = makeConfig("user-profiles-badarray");
      writeFileSync(
        join(cfg.userProfilesDir, "bad-array.yml"),
        "name: bad-array\nskills:\n  - good-skill\n  - 42\n",
      );

      registry.initialize(cfg);

      expect(registry.getProfiles().has("bad-array")).toBe(false);
    });

    it("user profiles override built-in profiles with same name", () => {
      const cfg = makeConfig("user-profiles-override");
      seedCoreProfiles(cfg.coreProfilesDir);
      createSkill(cfg.coreSkillsDir, "custom-reading");
      writeFileSync(
        join(cfg.userProfilesDir, "override.yml"),
        [
          "name: book.reading",
          "label: My Custom Book Reading",
          "skills: [custom-reading]",
          "extensions: []",
        ].join("\n"),
      );

      registry.initialize(cfg);

      const profile = registry.getProfiles().get("book.reading")!;
      expect(profile.label).toBe("My Custom Book Reading");
      expect(profile.skills).toEqual(["custom-reading"]);
    });

    it("defaults exclude_tools to [bash, edit] when not specified", () => {
      const cfg = makeConfig("user-profiles-defaults");
      writeFileSync(
        join(cfg.userProfilesDir, "minimal.yml"),
        "name: minimal-profile\nlabel: Minimal\nskills: []\n",
      );

      registry.initialize(cfg);

      const profile = registry.getProfiles().get("minimal-profile")!;
      expect(profile.excludeTools).toEqual(["bash", "edit"]);
    });

    it("defaults extensions to [] when not specified", () => {
      const cfg = makeConfig("user-profiles-noext");
      writeFileSync(
        join(cfg.userProfilesDir, "no-ext.yml"),
        "name: no-ext\nskills: [foo]\n",
      );

      registry.initialize(cfg);

      const profile = registry.getProfiles().get("no-ext")!;
      expect(profile.extensions).toEqual([]);
    });

    it("uses name as label fallback when label is omitted", () => {
      const cfg = makeConfig("user-profiles-nolabel");
      writeFileSync(
        join(cfg.userProfilesDir, "no-label.yml"),
        "name: my-profile\nskills: []\n",
      );

      registry.initialize(cfg);

      const profile = registry.getProfiles().get("my-profile")!;
      expect(profile.label).toBe("my-profile");
    });

    it("supports optional model override", () => {
      const cfg = makeConfig("user-profiles-model");
      writeFileSync(
        join(cfg.userProfilesDir, "with-model.yml"),
        "name: with-model\nlabel: With Model\nskills: []\nmodel: gpt-4o\n",
      );

      registry.initialize(cfg);

      const profile = registry.getProfiles().get("with-model")!;
      expect(profile.model).toBe("gpt-4o");
    });
  });
});
