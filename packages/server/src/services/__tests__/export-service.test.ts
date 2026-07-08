import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildJsonlBundle,
  parseImportBundle,
  buildSnapshot,
  scopeToBranch,
  exportFilename,
  EXPORT_BUNDLE_TYPE,
  EXPORT_BUNDLE_VERSION,
  type ExportContext,
} from "../export-service.js";
import { renderExportHtml } from "../export-template.js";
import type { TreeNodeView } from "@pi-tree/core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SDK_HEADER = {
  type: "session",
  version: 3,
  id: "0199-test",
  timestamp: "2026-07-01T00:00:00.000Z",
  cwd: "/home/someone/secret/path",
};

const SESSION_LINES = [
  JSON.stringify(SDK_HEADER),
  JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
  JSON.stringify({ type: "message", id: "m2", parentId: "m1", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } }),
];

function makeCtx(sessionFile: string): ExportContext {
  return {
    sessionRow: {
      id: 42,
      title: "My Reading Session",
      context: JSON.stringify({ mode: "reading" }),
      sessionFile,
    },
    sourceRow: {
      id: "test_book_2026",
      type: "book",
      title: "Test Book",
      subtitle: null,
      author: "Ann Author",
      year: 2026,
    },
  };
}

const TREE: TreeNodeView = {
  id: "m1",
  parentId: null,
  label: "root",
  status: "active",
  messageCount: 3,
  isCurrent: false,
  children: [
    {
      id: "m2",
      parentId: "m1",
      label: "hello branch",
      status: "active",
      messageCount: 1,
      isCurrent: true,
      children: [
        {
          id: "m4",
          parentId: "m2",
          label: "deeper",
          status: "active",
          messageCount: 1,
          isCurrent: false,
          children: [],
        },
      ],
    },
    {
      id: "m3",
      parentId: "m1",
      label: "sibling branch",
      status: "active",
      messageCount: 1,
      isCurrent: false,
      children: [],
    },
  ],
};

const CONTENTS = {
  m1: { role: "user", content: "hi", timestamp: "2026-07-01T00:00:01.000Z" },
  m2: { role: "assistant", content: "hello **world**", timestamp: "2026-07-01T00:00:02.000Z" },
  m3: { role: "assistant", content: "sibling secret", timestamp: "2026-07-01T00:00:03.000Z" },
  m4: { role: "user", content: "go deeper", timestamp: "2026-07-01T00:00:04.000Z" },
};

// ---------------------------------------------------------------------------
// buildJsonlBundle
// ---------------------------------------------------------------------------

describe("buildJsonlBundle", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-tree-export-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prepends an export header and keeps session lines", () => {
    const file = join(dir, "session.jsonl");
    writeFileSync(file, SESSION_LINES.join("\n") + "\n");

    const bundle = buildJsonlBundle(makeCtx(file));
    const lines = bundle.trim().split("\n");

    expect(lines).toHaveLength(4);
    const header = JSON.parse(lines[0]);
    expect(header.type).toBe(EXPORT_BUNDLE_TYPE);
    expect(header.version).toBe(EXPORT_BUNDLE_VERSION);
    expect(header.source.id).toBe("test_book_2026");
    expect(header.session.title).toBe("My Reading Session");
    expect(header.session.context.mode).toBe("reading");
    // Original message lines preserved verbatim
    expect(lines[2]).toBe(SESSION_LINES[1]);
    expect(lines[3]).toBe(SESSION_LINES[2]);
  });

  it("sanitizes the cwd in the SDK session header", () => {
    const file = join(dir, "session.jsonl");
    writeFileSync(file, SESSION_LINES.join("\n") + "\n");

    const bundle = buildJsonlBundle(makeCtx(file));
    const sdkHeader = JSON.parse(bundle.trim().split("\n")[1]);
    expect(sdkHeader.cwd).toBe("/");
    expect(bundle).not.toContain("secret");
    // Everything else in the header stays intact
    expect(sdkHeader.id).toBe("0199-test");
    expect(sdkHeader.version).toBe(3);
  });

  it("throws for a missing session file", () => {
    expect(() => buildJsonlBundle(makeCtx(join(dir, "nope.jsonl")))).toThrow(
      /no conversation content/,
    );
  });

  it("throws for an empty session file", () => {
    const file = join(dir, "empty.jsonl");
    writeFileSync(file, "\n");
    expect(() => buildJsonlBundle(makeCtx(file))).toThrow(/no conversation content/);
  });
});

// ---------------------------------------------------------------------------
// parseImportBundle — round-trip and validation
// ---------------------------------------------------------------------------

describe("parseImportBundle", () => {
  it("round-trips a bundle built by buildJsonlBundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-tree-export-"));
    const file = join(dir, "session.jsonl");
    writeFileSync(file, SESSION_LINES.join("\n") + "\n");

    const bundle = buildJsonlBundle(makeCtx(file));
    const { header, sessionLines } = parseImportBundle(bundle);

    expect(header.source.title).toBe("Test Book");
    expect(sessionLines).toHaveLength(3);
    expect(JSON.parse(sessionLines[0]).type).toBe("session");
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects non-export files", () => {
    expect(() => parseImportBundle("hello\nworld")).toThrow(/Not a pi-tree export/);
    expect(() => parseImportBundle(SESSION_LINES.join("\n"))).toThrow(/Not a pi-tree export/);
  });

  it("rejects future versions", () => {
    const header = {
      type: EXPORT_BUNDLE_TYPE,
      version: 999,
      source: { id: "x", title: "X" },
      session: { title: "t", context: { mode: "reading" } },
    };
    const text = [JSON.stringify(header), ...SESSION_LINES].join("\n");
    expect(() => parseImportBundle(text)).toThrow(/Unsupported export version/);
  });

  it("rejects bundles with malformed session data", () => {
    const header = {
      type: EXPORT_BUNDLE_TYPE,
      version: 1,
      source: { id: "x", title: "X" },
      session: { title: "t", context: { mode: "reading" } },
    };
    const text = [JSON.stringify(header), '{"type":"not-a-session"}'].join("\n");
    expect(() => parseImportBundle(text)).toThrow(/malformed session data/);
  });

  it("rejects bundles missing source metadata", () => {
    const header = { type: EXPORT_BUNDLE_TYPE, version: 1, source: {}, session: {} };
    const text = [JSON.stringify(header), ...SESSION_LINES].join("\n");
    expect(() => parseImportBundle(text)).toThrow(/missing source metadata/);
  });
});

// ---------------------------------------------------------------------------
// Snapshot + HTML rendering
// ---------------------------------------------------------------------------

describe("buildSnapshot / renderExportHtml", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-tree-export-"));
  const file = join(dir, "session.jsonl");
  writeFileSync(file, SESSION_LINES.join("\n") + "\n");
  const snapshot = buildSnapshot(makeCtx(file), TREE, CONTENTS);

  // Fixture viewer template — renderExportHtml injects into the built
  // dist/viewer.html in production; tests use a minimal stand-in.
  const templateFile = join(dir, "viewer.html");
  writeFileSync(
    templateFile,
    '<!DOCTYPE html><html><head><title>pi-tree session</title></head>' +
      '<body><div id="root"></div><script type="module">/*bundle*/</script></body></html>',
  );

  beforeEach(() => {
    process.env.PI_TREE_VIEWER_TEMPLATE = templateFile;
  });
  afterEach(() => {
    delete process.env.PI_TREE_VIEWER_TEMPLATE;
  });

  it("builds a sanitized snapshot", () => {
    expect(snapshot.format).toBe("pi-tree-session");
    expect(snapshot.session.title).toBe("My Reading Session");
    expect(snapshot.session.mode).toBe("reading");
    expect(snapshot.tree.children[0].id).toBe("m2");
    const json = JSON.stringify(snapshot);
    // No user identity or local paths anywhere in the snapshot
    expect(json).not.toContain("sessionFile");
    expect(json).not.toContain("userId");
  });

  it("injects the snapshot and title into the viewer template", () => {
    const html = renderExportHtml(snapshot);
    expect(html).toContain("<title>My Reading Session — Test Book</title>");
    // Snapshot script injected in <head>, before the bundle module script
    const injectAt = html.indexOf("window.__PI_TREE__");
    expect(injectAt).toBeGreaterThan(-1);
    expect(injectAt).toBeLessThan(html.indexOf("/*bundle*/"));
    expect(html).toContain("hello **world**");
  });

  it("escapes </script> content so the embed cannot break out", () => {
    const evil = buildSnapshot(makeCtx(file), TREE, {
      m1: { role: "user", content: "</script><script>alert(1)</script>", timestamp: "t" },
    });
    const html = renderExportHtml(evil);
    expect(html).not.toContain("</script><script>alert");
    expect(html).toContain("\\u003c/script");
  });
});

// ---------------------------------------------------------------------------
// scopeToBranch
// ---------------------------------------------------------------------------

describe("scopeToBranch", () => {
  it("keeps the full root→node lineage plus the node's subtree", () => {
    const scoped = scopeToBranch(TREE, CONTENTS, "m2");
    // Tree still starts at root, pruned to a single-child chain
    expect(scoped.tree.id).toBe("m1");
    expect(scoped.tree.children.map((c) => c.id)).toEqual(["m2"]);
    // The branch node keeps its whole subtree
    expect(scoped.tree.children[0].children.map((c) => c.id)).toEqual(["m4"]);
    // Lineage + subtree contents included; sibling content excluded
    expect(Object.keys(scoped.contents).sort()).toEqual(["m1", "m2", "m4"]);
    expect(scoped.contents["m3"]).toBeUndefined();
    expect(scoped.branch).toEqual({
      nodeId: "m2",
      label: "hello branch",
      path: ["root"],
    });
  });

  it("threads through buildSnapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-tree-export-"));
    const file = join(dir, "session.jsonl");
    writeFileSync(file, SESSION_LINES.join("\n") + "\n");
    const snap = buildSnapshot(makeCtx(file), TREE, CONTENTS, "m2");
    expect(snap.branch?.nodeId).toBe("m2");
    expect(snap.tree.id).toBe("m1");
    expect(snap.contents["m1"]).toBeDefined();
    expect(snap.contents["m3"]).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws for an unknown node", () => {
    expect(() => scopeToBranch(TREE, CONTENTS, "nope")).toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// exportFilename
// ---------------------------------------------------------------------------

describe("exportFilename", () => {
  it("slugifies titles", () => {
    expect(exportFilename("My Reading: Chapter 1!", "html")).toBe("my-reading-chapter-1.html");
  });
  it("falls back for empty titles", () => {
    expect(exportFilename("???", "pi-tree.jsonl")).toBe("session.pi-tree.jsonl");
  });
});
