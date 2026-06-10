/**
 * Tests for McpBridge — config loading, tool discovery, callTool routing.
 *
 * These test the bridge's config parsing and state management without
 * spawning real MCP server processes (no network, no child processes).
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpBridge, loadMcpConfig } from "../mcp-bridge.js";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_ROOT = mkdtempSync(join(tmpdir(), "mcp-bridge-test-"));

/** Write a config file and return its path */
function writeConfig(name: string, content: unknown): string {
  const path = join(TEST_ROOT, `${name}.json`);
  writeFileSync(path, JSON.stringify(content, null, 2));
  return path;
}

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ─── loadMcpConfig ─────────────────────────────────────────────────────────────

describe("loadMcpConfig", () => {
  it("returns null for missing file", () => {
    const result = loadMcpConfig(join(TEST_ROOT, "nonexistent.json"));
    expect(result).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const path = join(TEST_ROOT, "bad.json");
    writeFileSync(path, "not json {{{");
    const result = loadMcpConfig(path);
    expect(result).toBeNull();
  });

  it("returns null for empty mcpServers", () => {
    const path = writeConfig("empty-servers", { mcpServers: {} });
    const result = loadMcpConfig(path);
    expect(result).toBeNull();
  });

  it("returns null for missing mcpServers key", () => {
    const path = writeConfig("no-key", { otherStuff: true });
    const result = loadMcpConfig(path);
    expect(result).toBeNull();
  });

  it("returns null for non-object mcpServers", () => {
    const path = writeConfig("array-servers", { mcpServers: ["not", "an", "object"] });
    const result = loadMcpConfig(path);
    expect(result).toBeNull();
  });

  it("parses valid config", () => {
    const path = writeConfig("valid", {
      mcpServers: {
        "brave-search": {
          command: "npx",
          args: ["-y", "@brave/brave-search-mcp-server"],
          env: { BRAVE_API_KEY: "test-key" },
        },
      },
    });
    const result = loadMcpConfig(path);
    expect(result).not.toBeNull();
    expect(result!.mcpServers["brave-search"].command).toBe("npx");
    expect(result!.mcpServers["brave-search"].env?.BRAVE_API_KEY).toBe("test-key");
  });

  it("parses config with multiple servers", () => {
    const path = writeConfig("multi", {
      mcpServers: {
        "server-a": { command: "echo", args: ["a"] },
        "server-b": { url: "http://localhost:8080/sse" },
        "server-c": { command: "echo", args: ["c"], disabled: true },
      },
    });
    const result = loadMcpConfig(path);
    expect(result).not.toBeNull();
    expect(Object.keys(result!.mcpServers)).toHaveLength(3);
    expect(result!.mcpServers["server-c"].disabled).toBe(true);
  });
});

// ─── McpBridge (state management) ──────────────────────────────────────────────

describe("McpBridge", () => {
  let bridge: McpBridge;

  beforeEach(() => {
    bridge = new McpBridge();
  });

  describe("initial state", () => {
    it("starts with no servers", () => {
      expect(bridge.hasServers()).toBe(false);
    });

    it("starts with no tools", () => {
      expect(bridge.getTools()).toEqual([]);
    });

    it("starts with no server names", () => {
      expect(bridge.getServerNames()).toEqual([]);
    });
  });

  describe("connectAll with invalid configs", () => {
    it("handles missing config file gracefully", async () => {
      await bridge.connectAll(join(TEST_ROOT, "does-not-exist.json"));
      expect(bridge.hasServers()).toBe(false);
      expect(bridge.getTools()).toEqual([]);
    });

    it("handles invalid JSON gracefully", async () => {
      const path = join(TEST_ROOT, "bad-connect.json");
      writeFileSync(path, "{{invalid json}}");
      await bridge.connectAll(path);
      expect(bridge.hasServers()).toBe(false);
    });

    it("handles empty mcpServers gracefully", async () => {
      const path = writeConfig("empty-connect", { mcpServers: {} });
      await bridge.connectAll(path);
      expect(bridge.hasServers()).toBe(false);
    });
  });

  describe("connectAll with servers that fail to spawn", () => {
    it("skips disabled servers", async () => {
      const path = writeConfig("disabled", {
        mcpServers: {
          "disabled-server": {
            command: "echo",
            args: ["hello"],
            disabled: true,
          },
        },
      });
      await bridge.connectAll(path);
      expect(bridge.hasServers()).toBe(false);
      expect(bridge.getTools()).toEqual([]);
    });

    it("skips servers with no command or url", async () => {
      const path = writeConfig("no-transport", {
        mcpServers: {
          "bad-server": {
            env: { FOO: "bar" },
          },
        },
      });
      await bridge.connectAll(path);
      expect(bridge.hasServers()).toBe(false);
    });

    it("skips servers that fail to connect (bad command)", async () => {
      const path = writeConfig("bad-cmd", {
        mcpServers: {
          "bad-server": {
            command: "/usr/bin/this-command-does-not-exist-xyz123",
            args: [],
          },
        },
      });
      // Should not throw — errors are caught and logged
      await bridge.connectAll(path);
      expect(bridge.hasServers()).toBe(false);
    });
  });

  describe("callTool", () => {
    it("throws for unknown server", async () => {
      await expect(
        bridge.callTool("nonexistent", "some_tool", {}),
      ).rejects.toThrow('MCP server "nonexistent" is not connected');
    });
  });

  describe("disconnectAll", () => {
    it("is safe to call with no connections", async () => {
      await bridge.disconnectAll();
      expect(bridge.hasServers()).toBe(false);
      expect(bridge.getTools()).toEqual([]);
    });

    it("is safe to call multiple times", async () => {
      await bridge.disconnectAll();
      await bridge.disconnectAll();
      expect(bridge.hasServers()).toBe(false);
    });
  });
});
