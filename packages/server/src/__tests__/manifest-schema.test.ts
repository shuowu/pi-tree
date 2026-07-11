/**
 * Tests for plugin manifest validation (manifest-schema.ts).
 *
 * Covers:
 * - Valid manifests from real plugins (book, news, paper, youtube, mcp)
 * - Structural errors (missing key, bad types, invalid enum values)
 * - Semantic warnings (autoStartMode not in sessionModes, etc.)
 * - Edge cases (empty piTree, routePrefix without routes, etc.)
 */
import { describe, it, expect } from "vitest";
import { validatePluginManifest, piTreeManifestSchema, sourceTypeManifestSchema } from "../services/manifest-schema.js";

// ---------------------------------------------------------------------------
// Real plugin manifests (copied from actual package.json piTree fields)
// ---------------------------------------------------------------------------

const BOOK_MANIFEST = {
  piTree: {
    sourceType: {
      key: "book",
      label: "Book",
      icon: "book-open",
      sessionModes: ["reading", "qa", "custom"],
      defaultMode: "reading",
      hasProcessing: true,
      searchPlaceholder: "Search books...",
      chatPlaceholder: "Ask about the book…",
      addSource: {
        subtitle: "Upload an EPUB, MOBI, PDF, or Markdown file",
        hasFileUpload: true,
        acceptedExtensions: [".epub", ".mobi", ".pdf", ".md"],
        fields: [
          { key: "title", label: "Title", required: true, placeholder: "Book title" },
          { key: "author", label: "Author", required: true, placeholder: "Author name" },
          { key: "year", label: "Year", type: "number" as const, placeholder: "Publication year" },
        ],
      },
      badges: [
        { field: "hasMarkdown", label: "Converted", color: "green" },
        { field: "hasOutline", label: "Outline", color: "amber" },
        { field: "source", value: "upload", label: "Uploaded", color: "blue" },
      ],
      cardSubtitle: "{author}, {year}",
    },
    ui: { contentPanel: "./ui/ContentPanel.tsx" },
  },
  pi: { extensions: ["./index.ts"], skills: ["./skills"] },
};

const NEWS_MANIFEST = {
  piTree: {
    sourceType: {
      key: "news",
      label: "News Feed",
      icon: "newspaper",
      sessionModes: ["news"],
      defaultMode: "news",
      autoStartMode: "news",
      hasProcessing: false,
      mentionKeyword: "News",
      fixedSourceId: "news",
      sessionStrategy: "time-based",
      askAfterHours: 4,
      staleAfterHours: 12,
      routingContextFile: "sources/news/feeds.json",
      routingContextLabel: "Available news feeds and topic tags",
      tagPromptTemplate: "Focus on feeds tagged '{tags}'",
      qualifierPromptTemplate: "Focus on the {qualifier} feed",
      addSource: { subtitle: "Configure RSS feeds and news sources" },
    },
    routes: "./routes.ts",
    routePrefix: "/api/news",
    ui: { contentPanel: "./ui/NewsDashboardPanel.tsx" },
  },
  pi: { extensions: ["./index.ts"], skills: ["./skills"] },
};

const YOUTUBE_MANIFEST = {
  piTree: {
    sourceType: {
      key: "youtube",
      label: "YouTube",
      icon: "circle-play",
      sessionModes: ["watching", "custom"],
      defaultMode: "watching",
      autoStartMode: "watching",
      systemContext: [
        "[SYSTEM CONTEXT — YouTube Session]",
        "Video Source ID: {sourceId}",
      ],
      addSource: { subtitle: "Paste a YouTube link to add a video" },
    },
    routes: "./routes.ts",
    routePrefix: "/api/youtube",
  },
  pi: { extensions: ["./index.ts"], skills: ["./skills"] },
};

const MCP_MANIFEST = {
  pi: { extensions: ["./index.ts"] },
};

// ---------------------------------------------------------------------------
// Tests — real manifests
// ---------------------------------------------------------------------------

describe("Manifest validation — real plugins", () => {
  it("validates the book plugin manifest", () => {
    const result = validatePluginManifest(BOOK_MANIFEST, "book");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("validates the news plugin manifest", () => {
    const result = validatePluginManifest(NEWS_MANIFEST, "news");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("validates the youtube plugin manifest", () => {
    const result = validatePluginManifest(YOUTUBE_MANIFEST, "youtube");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("validates the mcp plugin manifest (pi only, no piTree)", () => {
    const result = validatePluginManifest(MCP_MANIFEST, "mcp");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    // No warning — pi field is present
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests — plural sourceTypes[] (a plugin owning several source types)
// ---------------------------------------------------------------------------

describe("Manifest validation — sourceTypes array", () => {
  it("accepts sourceType plus additional sourceTypes entries", () => {
    const pkg = {
      piTree: {
        sourceType: { key: "news", sessionModes: ["news"], defaultMode: "news" },
        sourceTypes: [
          {
            key: "article",
            label: "Article",
            sessionModes: ["reading", "custom"],
            defaultMode: "reading",
            systemContext: ["Title: {title}", "URL: {url}"],
          },
        ],
      },
    };
    const result = validatePluginManifest(pkg, "news");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("rejects invalid keys inside sourceTypes entries", () => {
    const pkg = { piTree: { sourceTypes: [{ key: "Bad Key" }] } };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("sourceTypes"))).toBe(true);
  });

  it("emits semantic warnings for sourceTypes entries too", () => {
    const pkg = {
      piTree: {
        sourceTypes: [
          { key: "article", sessionModes: ["reading"], defaultMode: "qa" },
        ],
      },
    };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("defaultMode"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — structural validation errors
// ---------------------------------------------------------------------------

describe("Manifest validation — structural errors", () => {
  it("rejects sourceType.key with uppercase letters", () => {
    const pkg = { piTree: { sourceType: { key: "MyPlugin" } } };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("key");
  });

  it("rejects sourceType.key with spaces", () => {
    const pkg = { piTree: { sourceType: { key: "my plugin" } } };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("key");
  });

  it("rejects invalid badge color", () => {
    const pkg = {
      piTree: {
        sourceType: {
          key: "test",
          badges: [{ field: "status", label: "Active", color: "purple" }],
        },
      },
    };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("color"))).toBe(true);
  });

  it("rejects invalid sessionStrategy enum value", () => {
    const pkg = {
      piTree: {
        sourceType: { key: "test", sessionStrategy: "always-new" },
      },
    };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("sessionStrategy"))).toBe(true);
  });

  it("rejects routePrefix without routes", () => {
    const pkg = { piTree: { routePrefix: "/api/test" } };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("routePrefix requires routes"))).toBe(true);
  });

  it("rejects routePrefix that doesn't start with /", () => {
    const pkg = { piTree: { routes: "./routes.ts", routePrefix: "api/test" } };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("routePrefix"))).toBe(true);
  });

  it("rejects addSource.fields[] with empty key", () => {
    const pkg = {
      piTree: {
        sourceType: {
          key: "test",
          addSource: {
            subtitle: "Test",
            fields: [{ key: "", label: "Name" }],
          },
        },
      },
    };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("key"))).toBe(true);
  });

  it("rejects invalid pi.extensions type (string instead of array)", () => {
    const pkg = { pi: { extensions: "./index.ts" } };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("pi."))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — semantic warnings
// ---------------------------------------------------------------------------

describe("Manifest validation — semantic warnings", () => {
  it("warns when autoStartMode is not in sessionModes", () => {
    const pkg = {
      piTree: {
        sourceType: {
          key: "test",
          sessionModes: ["reading", "custom"],
          autoStartMode: "analysis",
        },
      },
    };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes("autoStartMode"))).toBe(true);
  });

  it("warns when defaultMode is not in sessionModes", () => {
    const pkg = {
      piTree: {
        sourceType: {
          key: "test",
          sessionModes: ["reading"],
          defaultMode: "qa",
        },
      },
    };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes("defaultMode"))).toBe(true);
  });

  it("warns when askAfterHours >= staleAfterHours", () => {
    const pkg = {
      piTree: {
        sourceType: {
          key: "test",
          sessionStrategy: "time-based",
          askAfterHours: 12,
          staleAfterHours: 4,
        },
      },
    };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes("askAfterHours"))).toBe(true);
  });

  it("warns when routingContextFile is set without routingContextLabel", () => {
    const pkg = {
      piTree: {
        sourceType: {
          key: "test",
          routingContextFile: "some/file.json",
        },
      },
    };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes("routingContextLabel"))).toBe(true);
  });

  it("warns when routePrefix doesn't follow /api/* convention", () => {
    const pkg = {
      piTree: {
        routes: "./routes.ts",
        routePrefix: "/custom/path",
      },
    };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes("/api/"))).toBe(true);
  });

  it("warns when neither pi nor piTree is present", () => {
    const pkg = { name: "not-a-plugin" };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes("neither"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — edge cases
// ---------------------------------------------------------------------------

describe("Manifest validation — edge cases", () => {
  it("accepts minimal valid piTree (empty object)", () => {
    const pkg = { piTree: {} };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(true);
  });

  it("accepts sourceType with only key", () => {
    const pkg = { piTree: { sourceType: { key: "minimal" } } };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts routes with prefix", () => {
    const pkg = { piTree: { routes: "./routes.ts", routePrefix: "/api/test" } };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(true);
  });

  it("accepts routes without prefix (defaults at runtime)", () => {
    const pkg = { piTree: { routes: "./routes.ts" } };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(true);
  });

  it("no warnings for autoStartMode when sessionModes is not set", () => {
    const pkg = {
      piTree: {
        sourceType: { key: "test", autoStartMode: "reading" },
      },
    };
    const result = validatePluginManifest(pkg, "test");
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests — Zod schemas directly
// ---------------------------------------------------------------------------

describe("sourceTypeManifestSchema", () => {
  it("accepts valid key with hyphens", () => {
    const result = sourceTypeManifestSchema.safeParse({ key: "my-source-type" });
    expect(result.success).toBe(true);
  });

  it("rejects key with underscores", () => {
    const result = sourceTypeManifestSchema.safeParse({ key: "my_source" });
    expect(result.success).toBe(false);
  });

  it("rejects empty key", () => {
    const result = sourceTypeManifestSchema.safeParse({ key: "" });
    expect(result.success).toBe(false);
  });
});

describe("piTreeManifestSchema", () => {
  it("accepts full manifest", () => {
    const result = piTreeManifestSchema.safeParse({
      sourceType: { key: "podcast", label: "Podcast", icon: "headphones" },
      routes: "./routes.ts",
      routePrefix: "/api/podcast",
      ui: { contentPanel: "./ui/Panel.tsx" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects routePrefix without routes via refinement", () => {
    const result = piTreeManifestSchema.safeParse({
      routePrefix: "/api/test",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some(i => i.message.includes("routePrefix requires routes"))).toBe(true);
  });
});
