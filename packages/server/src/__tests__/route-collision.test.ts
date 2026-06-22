/**
 * Tests for route prefix collision detection in AgentRegistry.
 *
 * Creates temporary plugin directories with conflicting route prefixes
 * to verify the registry throws a clear error at startup.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentRegistry } from "../services/agent-registry.js";

/** Create a minimal plugin directory with a package.json */
function createPlugin(
  dir: string,
  name: string,
  piTree: Record<string, unknown>,
): void {
  const pluginDir = join(dir, name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, "package.json"),
    JSON.stringify({ name, piTree }, null, 2),
  );
  // Create a dummy routes file so the path resolves
  if (piTree.routes) {
    writeFileSync(join(pluginDir, piTree.routes as string), "// stub");
  }
}

describe("Route prefix collision detection", () => {
  let pluginsDir: string;
  let dataDir: string;

  beforeEach(() => {
    const base = join(tmpdir(), `pi-tree-collision-test-${Date.now()}`);
    pluginsDir = join(base, "plugins");
    dataDir = join(base, "data");
    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    const base = join(pluginsDir, "..");
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("throws when two plugins register the same route prefix", () => {
    createPlugin(pluginsDir, "plugin-alpha", {
      routes: "./routes.ts",
      routePrefix: "/api/shared",
    });
    createPlugin(pluginsDir, "plugin-beta", {
      routes: "./routes.ts",
      routePrefix: "/api/shared",
    });

    const registry = new AgentRegistry();
    expect(() =>
      registry.initialize({
        coreDir: pluginsDir, // won't find agents/ here, that's fine
        dataDir,
        corePluginDirs: [
          join(pluginsDir, "plugin-alpha"),
          join(pluginsDir, "plugin-beta"),
        ],
      }),
    ).toThrow(/route prefix collision/i);
  });

  it("throws with a message naming both plugins", () => {
    createPlugin(pluginsDir, "plugin-foo", {
      routes: "./routes.ts",
      routePrefix: "/api/overlap",
    });
    createPlugin(pluginsDir, "plugin-bar", {
      routes: "./routes.ts",
      routePrefix: "/api/overlap",
    });

    const registry = new AgentRegistry();
    try {
      registry.initialize({
        coreDir: pluginsDir,
        dataDir,
        corePluginDirs: [
          join(pluginsDir, "plugin-foo"),
          join(pluginsDir, "plugin-bar"),
        ],
      });
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("plugin-foo");
      expect(err.message).toContain("plugin-bar");
      expect(err.message).toContain("/api/overlap");
    }
  });

  it("does NOT throw when plugins have different prefixes", () => {
    createPlugin(pluginsDir, "plugin-one", {
      routes: "./routes.ts",
      routePrefix: "/api/one",
    });
    createPlugin(pluginsDir, "plugin-two", {
      routes: "./routes.ts",
      routePrefix: "/api/two",
    });

    const registry = new AgentRegistry();
    expect(() =>
      registry.initialize({
        coreDir: pluginsDir,
        dataDir,
        corePluginDirs: [
          join(pluginsDir, "plugin-one"),
          join(pluginsDir, "plugin-two"),
        ],
      }),
    ).not.toThrow();
  });

  it("detects collisions from default slug-based prefixes", () => {
    // Both plugins named "shared" in different dirs — same default /api/shared
    const dir1 = join(pluginsDir, "dir1", "shared");
    const dir2 = join(pluginsDir, "dir2", "shared");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    writeFileSync(
      join(dir1, "package.json"),
      JSON.stringify({ name: "shared", piTree: { routes: "./routes.ts" } }),
    );
    writeFileSync(join(dir1, "routes.ts"), "// stub");

    writeFileSync(
      join(dir2, "package.json"),
      JSON.stringify({ name: "also-shared", piTree: { routes: "./routes.ts", routePrefix: "/api/shared" } }),
    );
    writeFileSync(join(dir2, "routes.ts"), "// stub");

    const registry = new AgentRegistry();
    expect(() =>
      registry.initialize({
        coreDir: pluginsDir,
        dataDir,
        corePluginDirs: [dir1, dir2],
      }),
    ).toThrow(/route prefix collision/i);
  });
});
