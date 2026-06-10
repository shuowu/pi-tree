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

/** Build a test config pointing at temp directories */
function makeConfig(suffix: string) {
  const coreDir = join(TEST_ROOT, suffix, "core");
  const coreSkillsDir = join(coreDir, "skills");
  const coreExtDir = join(coreDir, "extensions");
  const userSkillsDir = join(TEST_ROOT, suffix, "user-skills");
  const userExtensionsDir = join(TEST_ROOT, suffix, "user-extensions");
  mkdirSync(coreSkillsDir, { recursive: true });
  mkdirSync(coreExtDir, { recursive: true });
  mkdirSync(userSkillsDir, { recursive: true });
  mkdirSync(userExtensionsDir, { recursive: true });
  return {
    // AgentRegistryConfig fields
    coreAgentsDir: coreDir,
    userSkillsDir,
    userExtensionsDir,
    // Convenience accessors for tests
    coreSkillsDir,
    coreExtDir,
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
      expect(skills[0].path).toContain("user-skills");
    });

    it("user extensions override core extensions with same name", () => {
      const cfg = makeConfig("disc-override-ext");
      createExtension(cfg.coreExtDir, "news", "// core");
      createExtension(cfg.userExtensionsDir, "news", "// user override");

      registry.initialize(cfg);

      const extensions = registry.getExtensions();
      expect(extensions).toHaveLength(1);
      expect(extensions[0].name).toBe("news");
      expect(extensions[0].source).toBe("user");
      expect(extensions[0].path).toContain("user-extensions");
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
        coreAgentsDir: "/tmp/nonexistent-dir-12345",
        userSkillsDir: "/tmp/also-nonexistent-67890",
        userExtensionsDir: "/tmp/nope-11111",
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
      createSkill(cfg.coreSkillsDir, "interactive-reading");
      createSkill(cfg.coreSkillsDir, "book-outline");
      createSkill(cfg.coreSkillsDir, "book-analysis");
      createSkill(cfg.coreSkillsDir, "news-reading");
      createSkill(cfg.coreSkillsDir, "session-router");
      createExtension(cfg.coreExtDir, "library");
      createExtension(cfg.coreExtDir, "news");
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
      expect(profile.extensions).toEqual(["library", "mcp"]);
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
  });

  // --- Validation ---

  describe("validate", () => {
    it("passes with valid profiles", () => {
      const cfg = makeConfig("valid-profiles");
      createSkill(cfg.coreSkillsDir, "interactive-reading");
      createSkill(cfg.coreSkillsDir, "book-analysis");
      createSkill(cfg.coreSkillsDir, "book-outline");
      createSkill(cfg.coreSkillsDir, "news-reading");
      createSkill(cfg.coreSkillsDir, "session-router");
      createExtension(cfg.coreExtDir, "library");
      createExtension(cfg.coreExtDir, "news");
      createExtension(cfg.coreExtDir, "mcp");
      registry.initialize(cfg);

      const result = registry.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("reports errors for missing skills referenced by profiles", () => {
      const cfg = makeConfig("missing-skills");
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
      createSkill(cfg.coreSkillsDir, "interactive-reading");
      createSkill(cfg.coreSkillsDir, "book-analysis");
      createSkill(cfg.coreSkillsDir, "book-outline");
      createSkill(cfg.coreSkillsDir, "news-reading");
      createSkill(cfg.coreSkillsDir, "session-router");
      createSkill(cfg.userSkillsDir, "orphan-skill"); // not used by any profile
      createExtension(cfg.coreExtDir, "library");
      createExtension(cfg.coreExtDir, "news");
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
      registry.initialize(cfg);

      const profiles = registry.getProfiles();
      expect(profiles.size).toBeGreaterThan(0);
      expect(profiles.has("book.reading")).toBe(true);
      expect(profiles.has("news.news")).toBe(true);
      expect(profiles.has("router")).toBe(true);
      expect(profiles.has("_default")).toBe(true);
    });
  });
});
