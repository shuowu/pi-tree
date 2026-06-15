import { describe, it, expect, vi, beforeEach } from "vitest";

// Initialize mock state on globalThis.
// By the time the test starts executing, this will be defined.
(globalThis as any).__mockState = {
  lastResourceLoaderOptions: null,
  mockReload: vi.fn().mockResolvedValue(undefined),
  mockSetAutoCompactionEnabled: vi.fn(),
  mockAppendCustomEntry: vi.fn(),
  mockGetEntries: vi.fn().mockReturnValue([]),
  mockGetLeafId: vi.fn().mockReturnValue("leaf-123"),
};

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    getAgentDir: vi.fn().mockReturnValue("/mock/agent/dir"),
    DefaultResourceLoader: class {
      constructor(options: any) {
        if ((globalThis as any).__mockState) {
          (globalThis as any).__mockState.lastResourceLoaderOptions = options;
        }
      }
      async reload() {
        return (globalThis as any).__mockState?.mockReload();
      }
      get extensionsResult() {
        return { extensions: [], errors: [] };
      }
    },
    SessionManager: {
      create: vi.fn().mockImplementation(() => ({
        getEntries: () => (globalThis as any).__mockState?.mockGetEntries() ?? [],
        getLeafId: () => (globalThis as any).__mockState?.mockGetLeafId() ?? "leaf-123",
        appendCustomEntry: (...args: any[]) => (globalThis as any).__mockState?.mockAppendCustomEntry(...args),
      })),
      open: vi.fn().mockImplementation(() => ({
        getEntries: () => (globalThis as any).__mockState?.mockGetEntries() ?? [],
        getLeafId: () => (globalThis as any).__mockState?.mockGetLeafId() ?? "leaf-123",
        appendCustomEntry: (...args: any[]) => (globalThis as any).__mockState?.mockAppendCustomEntry(...args),
      })),
    },
    SettingsManager: {
      create: vi.fn().mockReturnValue({}),
    },
    createAgentSession: vi.fn().mockImplementation(async () => ({
      session: {
        setAutoCompactionEnabled: (...args: any[]) =>
          (globalThis as any).__mockState?.mockSetAutoCompactionEnabled(...args),
      },
    })),
  };
});

// Import PiSession AFTER the mock has been registered so it uses the mocked module
import { PiSession } from "../pi-session.js";

import { configureModelRegistry } from "../model-setup.js";

describe("PiSession.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__mockState.lastResourceLoaderOptions = null;
    (globalThis as any).__mockState.mockReload.mockClear();
    (globalThis as any).__mockState.mockSetAutoCompactionEnabled.mockClear();
    (globalThis as any).__mockState.mockAppendCustomEntry.mockClear();
    (globalThis as any).__mockState.mockGetEntries.mockClear();
    (globalThis as any).__mockState.mockGetLeafId.mockClear();
  });

  it("passes noSkills, noContextFiles, and noPromptTemplates to DefaultResourceLoader", async () => {
    const userId = "test-user";
    const bookId = "test-book";
    const libraryPath = "/mock/library";
    const dataPath = "/mock/data";

    const initialResult = configureModelRegistry({ readingModel: "" });
    const builtInModel = initialResult.modelRegistry.getAll()[0];
    const modelId = builtInModel?.id ?? "test-model";

    const session = await PiSession.create(userId, bookId, libraryPath, dataPath, {
      config: {
        readingModel: modelId,
        repoRoot: "/mock/repo-root",
      },
    });

    expect(session).toBeDefined();
    const loaderOptions = (globalThis as any).__mockState.lastResourceLoaderOptions;
    expect(loaderOptions).toBeDefined();
    expect(loaderOptions.noSkills).toBe(true);
    expect(loaderOptions.noContextFiles).toBe(true);
    expect(loaderOptions.noPromptTemplates).toBe(true);
    expect(loaderOptions.cwd).toBe("/mock/repo-root");
  });
});
