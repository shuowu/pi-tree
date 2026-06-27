/**
 * TreeManager branching pipeline tests.
 *
 * Implements the test plan from docs/BRANCHING-TESTS.md.
 *
 * Strategy: Use `TreeManager._createForTest()` with a mock PiSession stub
 * that returns controlled tree shapes. This lets us test the branching
 * orchestration (handleMessage / handleMessageStreaming) without DB, LLM,
 * or file-system side effects.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AnnotatedTreeNode, TreeNodeView } from "@pi-tree/core";
import { TreeManager } from "../services/tree-manager.js";
import { PiSession } from "@pi-tree/core";

// ─── Mock PiSession ────────────────────────────────────────────────────────────

/**
 * Minimal PiSession stub for branching tests.
 *
 * We construct a real-looking mock that:
 * - Returns a configurable annotated tree from `getAnnotatedTree()`
 * - Tracks `simpleBranch()` calls so we can assert branching decisions
 * - Returns canned responses from `sendMessage()` / `sendMessageStreaming()`
 * - Returns a configurable content map from `getMessageContentMap()`
 */
function createMockPiSession(opts: {
  annotatedTree: AnnotatedTreeNode[];
  contentEntries?: Array<[string, string, string]>; // [id, role, content]
  breadcrumb?: Array<{ entryId: string; label: string }>;
  /** If set, the annotated tree switches to this after sendMessage/sendMessageStreaming */
  postSendTree?: AnnotatedTreeNode[];
}) {
  const simpleBranchCalls: string[] = [];
  let currentTree = opts.annotatedTree;

  const contentMap = new Map<
    string,
    { role: string; content: string; timestamp: string }
  >();
  for (const [id, role, content] of opts.contentEntries ?? []) {
    contentMap.set(id, { role, content, timestamp: "2026-01-01T00:00:00Z" });
  }

  const mock = {
    getAnnotatedTree: vi.fn(() => currentTree),

    simpleBranch: vi.fn((entryId: string) => {
      simpleBranchCalls.push(entryId);
    }),

    sendMessage: vi.fn(async (_msg: string) => {
      if (opts.postSendTree) currentTree = opts.postSendTree;
      return { response: "AI response", entryId: "ai-response-1" };
    }),

    sendMessageStreaming: vi.fn(
      async (
        _msg: string,
        onToken: (t: string) => Promise<void>,
        onTurnEnd?: () => Promise<void>,
      ) => {
        if (opts.postSendTree) currentTree = opts.postSendTree;
        await onToken("AI ");
        await onToken("response");
        if (onTurnEnd) await onTurnEnd();
        return { response: "AI response", entryId: "ai-response-1" };
      },
    ),

    getMessageContentMap: vi.fn(() => contentMap),

    getBreadcrumb: vi.fn(
      () => opts.breadcrumb ?? [{ entryId: "root", label: "root" }],
    ),

    branchAt: vi.fn(),
    branchWithSummary: vi.fn(),
    updateStatus: vi.fn(),
    updateLabel: vi.fn(),
    getSessionFile: vi.fn(() => "test-session.jsonl"),

    // --- helpers for test assertions ---
    _simpleBranchCalls: simpleBranchCalls,
    _setTree: (tree: AnnotatedTreeNode[]) => {
      currentTree = tree;
    },
    _addContentEntry: (id: string, role: string, content: string) => {
      contentMap.set(id, {
        role,
        content,
        timestamp: "2026-01-01T00:00:00Z",
      });
    },
  };

  return mock;
}

type MockPiSession = ReturnType<typeof createMockPiSession>;

function createTreeManager(mock: MockPiSession): TreeManager {
  return TreeManager._createForTest(mock as unknown as PiSession);
}

// ─── Tree Builders ─────────────────────────────────────────────────────────────

/**
 * Build AnnotatedTreeNode for test trees.
 * These represent the Pi SDK's annotated tree, which TreeManager converts
 * to TreeNodeView via annotatedToView().
 */
function aNode(
  id: string,
  label: string,
  children: AnnotatedTreeNode[] = [],
  overrides?: Partial<AnnotatedTreeNode>,
): AnnotatedTreeNode {
  return {
    entryId: id,
    parentId: "root",
    label,
    source: "user",
    status: "active",
    messageCount: 0,
    isCurrent: false,
    children,
    ...overrides,
  };
}

function aUserNode(
  id: string,
  label: string,
  children: AnnotatedTreeNode[] = [],
  overrides?: Partial<AnnotatedTreeNode>,
): AnnotatedTreeNode {
  return aNode(id, label, children, overrides);
}

function aAINode(
  id: string,
  label: string,
  children: AnnotatedTreeNode[] = [],
  overrides?: Partial<AnnotatedTreeNode>,
): AnnotatedTreeNode {
  return aNode(id, `✦ ${label}`, children, { source: "auto", ...overrides });
}

// =============================================================================
// Phase 1: Branching Pipeline
// =============================================================================

describe("TreeManager — Phase 1: Branching Pipeline", () => {
  // ---------------------------------------------------------------------------
  // 1a. Fork from mid-thread (Issue 1)
  // ---------------------------------------------------------------------------

  describe("1a. Fork from mid-thread (forceBranch)", () => {
    it("calls simpleBranch on the AI node when forceBranch=true", async () => {
      // Tree: p1 → AI_p1 → c1 → AI_c1 → c2 → AI_c2 → c3 → AI_c3
      //                                                 ↑ fork here
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c2", "msg 3", [
                  aAINode("AI_c2", "resp 3", [
                    aUserNode("c3", "msg 4", [
                      aAINode("AI_c3", "resp 4", [], { isCurrent: true }),
                    ], { isCurrent: true }),
                  ], { isCurrent: true }),
                ], { isCurrent: true }),
              ], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      // After fork + sendMessage, the tree has 2 children under AI_c2
      const postTree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c2", "msg 3", [
                  aAINode("AI_c2", "resp 3", [
                    aUserNode("c3", "msg 4", [
                      aAINode("AI_c3", "resp 4"),
                    ]),
                    aUserNode("c_new", "forked msg", [
                      aAINode("ai-response-1", "fork resp", [], {
                        isCurrent: true,
                      }),
                    ], { isCurrent: true }),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        postSendTree: postTree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["c1", "user", "msg 2"],
          ["AI_c1", "assistant", "resp 2"],
          ["c2", "user", "msg 3"],
          ["AI_c2", "assistant", "resp 3"],
          ["c3", "user", "msg 4"],
          ["AI_c3", "assistant", "resp 4"],
        ],
      });
      const tm = createTreeManager(mock);

      const result = await tm.handleMessage("fork question", "c2", {
        forceBranch: true,
      });

      // findBranchPoint("c2") should find AI_c2 (first AI child of c2)
      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_c2");
      expect(mock.sendMessage).toHaveBeenCalledWith("fork question");
      expect(result.response).toBe("AI response");
    });

    it("redirects viewNodeId to the new fork scope after forceBranch", async () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      // After fork: AI_c1 now has 2 children
      const postTree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c_new", "forked", [
                  aAINode("ai-response-1", "fork resp", [], {
                    isCurrent: true,
                  }),
                ], { isCurrent: true }),
              ]),
            ]),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        postSendTree: postTree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["c1", "user", "msg 2"],
          ["AI_c1", "assistant", "resp 2"],
          ["c_new", "user", "forked"],
          ["ai-response-1", "assistant", "fork resp"],
        ],
      });
      const tm = createTreeManager(mock);

      const result = await tm.handleMessage("fork!", "c1", {
        forceBranch: true,
      });

      // forceBranch → scope resolved from current leaf
      // current leaf = ai-response-1, parent = c_new
      expect(result.viewNodeId).toBe("c_new");
    });
  });

  // ---------------------------------------------------------------------------
  // 1b. Linear continuation in fork (Issue 2)
  // ---------------------------------------------------------------------------

  describe("1b. Linear continuation in fork", () => {
    it("does NOT branch when continuing at the leaf of a forked branch", async () => {
      //   AI_c2 ─┬─ c3 → AI_c3
      //           └─ c_new → AI_new (current leaf)
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c2", "msg 3", [
                  aAINode("AI_c2", "resp 3", [
                    aUserNode("c3", "msg 4", [
                      aAINode("AI_c3", "resp 4"),
                    ]),
                    aUserNode("c_new", "forked msg", [
                      aAINode("AI_new", "fork resp", [], { isCurrent: true }),
                    ], { isCurrent: true }),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["c_new", "user", "forked msg"],
          ["AI_new", "assistant", "fork resp"],
        ],
      });
      const tm = createTreeManager(mock);

      await tm.handleMessage("continue in fork", "c_new");

      // No auto-branch needed → pointer positioned at deepest leaf (AI_new)
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_new");
      expect(mock.sendMessage).toHaveBeenCalledWith("continue in fork");
    });

    it("appends linearly in a deep fork branch", async () => {
      //   AI_c2 ─┬─ c3 → AI_c3
      //           └─ c_new → AI_new → c4 → AI_4 (current leaf)
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c2", "msg 3", [
                  aAINode("AI_c2", "resp 3", [
                    aUserNode("c3", "msg 4", [
                      aAINode("AI_c3", "resp 4"),
                    ]),
                    aUserNode("c_new", "fork msg", [
                      aAINode("AI_new", "fork resp", [
                        aUserNode("c4", "keep going", [
                          aAINode("AI_4", "more resp", [], {
                            isCurrent: true,
                          }),
                        ], { isCurrent: true }),
                      ], { isCurrent: true }),
                    ], { isCurrent: true }),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["c_new", "user", "fork msg"],
          ["AI_new", "assistant", "fork resp"],
          ["c4", "user", "keep going"],
          ["AI_4", "assistant", "more resp"],
        ],
      });
      const tm = createTreeManager(mock);

      // Message from c_new scope — no fork → pointer to deepest leaf (AI_4)
      await tm.handleMessage("even more", "c_new");
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_4");
    });
  });

  // ---------------------------------------------------------------------------
  // 1c. Auto-branch at existing fork point
  // ---------------------------------------------------------------------------

  describe("1c. Auto-branch at existing fork point — descendant check", () => {
    it("auto-branches from p1 when deep fork exists at AI_c2", async () => {
      //   p1 → AI_p1 → c1 → AI_c1 → c2 → AI_c2 ─┬─ c3 → AI_c3
      //                                             └─ c_new → AI_new (current)
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c2", "msg 3", [
                  aAINode("AI_c2", "resp 3", [
                    aUserNode("c3", "msg 4", [
                      aAINode("AI_c3", "resp 4"),
                    ]),
                    aUserNode("c_new", "forked", [
                      aAINode("AI_new", "resp", [], { isCurrent: true }),
                    ], { isCurrent: true }),
                  ], { isCurrent: true }),
                ], { isCurrent: true }),
              ], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [["p1", "user", "msg 1"]],
      });
      const tm = createTreeManager(mock);

      // needsAutoBranch walks: AI_p1 (1 child) → AI_c1 (1 child) → AI_c2 (2 children) → fork!
      await tm.handleMessage("continue from root", "p1");
      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_c2");
    });
  });

  // ---------------------------------------------------------------------------
  // 1d. Multiple forks from same node
  // ---------------------------------------------------------------------------

  describe("1d. Multiple forks from same node", () => {
    it("auto-branches when scope has fork (AI node has 2+ children)", async () => {
      //   AI_c2 ─┬─ c3 → AI_c3
      //           ├─ fork_1 → AI_f1
      //           └─ fork_2 → AI_f2 (current)
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c2", "msg 3", [
                  aAINode("AI_c2", "resp 3", [
                    aUserNode("c3", "msg 4", [
                      aAINode("AI_c3", "resp 4"),
                    ]),
                    aUserNode("fork_1", "fork 1", [
                      aAINode("AI_f1", "fork 1 resp"),
                    ]),
                    aUserNode("fork_2", "fork 2", [
                      aAINode("AI_f2", "fork 2 resp", [], {
                        isCurrent: true,
                      }),
                    ], { isCurrent: true }),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["c2", "user", "msg 3"],
          ["AI_c2", "assistant", "resp 3"],
        ],
      });
      const tm = createTreeManager(mock);

      // Scope c2 has a fork at AI_c2 (3 children) → auto-branch
      await tm.handleMessage("new branch", "c2");
      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_c2");
    });

    it("branches with forceBranch when AI node has 2+ children", async () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c2", "msg 3", [
                  aAINode("AI_c2", "resp 3", [
                    aUserNode("c3", "msg 4", [
                      aAINode("AI_c3", "resp 4"),
                    ]),
                    aUserNode("fork_1", "fork 1", [
                      aAINode("AI_f1", "fork 1 resp"),
                    ]),
                    aUserNode("fork_2", "fork 2", [
                      aAINode("AI_f2", "fork 2 resp", [], {
                        isCurrent: true,
                      }),
                    ], { isCurrent: true }),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["c2", "user", "msg 3"],
          ["AI_c2", "assistant", "resp 3"],
        ],
      });
      const tm = createTreeManager(mock);

      // With forceBranch: true → should branch
      await tm.handleMessage("yet another fork", "c2", { forceBranch: true });
      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_c2");
    });
  });

  // ---------------------------------------------------------------------------
  // 1e. viewNodeId null → scope resolved from current leaf
  // ---------------------------------------------------------------------------

  describe("1e. viewNodeId null — resolved from current leaf", () => {
    it("does not branch and resolves viewNodeId from current leaf", async () => {
      // Tree: p1 → AI_p1 → c1 → AI_c1 (current leaf)
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["c1", "user", "msg 2"],
          ["AI_c1", "assistant", "resp 2"],
        ],
      });
      const tm = createTreeManager(mock);

      const result = await tm.handleMessage("hello", null);

      // viewNodeId=null → effectiveViewNodeId is tree root → pointer to deepest leaf
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_c1");
      // Response viewNodeId should be resolved from current leaf
      // current leaf = AI_c1, parent = c1
      expect(result.viewNodeId).toBe("c1");
    });

    it("resolves viewNodeId when passing undefined", async () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
        ],
      });
      const tm = createTreeManager(mock);

      const result = await tm.handleMessage("hello");
      // viewNodeId not provided → treated as null → resolved from current leaf
      // current leaf = AI_p1, parent = p1
      expect(result.viewNodeId).toBe("p1");
    });
  });

  // ---------------------------------------------------------------------------
  // 1f. forceBranch + viewNodeId
  // ---------------------------------------------------------------------------

  describe("1f. forceBranch + viewNodeId", () => {
    it("branches from the AI child of viewNodeId", async () => {
      // Tree: p1 → AI_p1 → c1 → AI_c1 → c2 → AI_c2 (current)
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c2", "msg 3", [
                  aAINode("AI_c2", "resp 3", [], { isCurrent: true }),
                ], { isCurrent: true }),
              ], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const postTree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c2", "msg 3", [
                  aAINode("AI_c2", "resp 3"),
                ]),
                aUserNode("c_fork", "forked", [
                  aAINode("ai-response-1", "fork resp", [], {
                    isCurrent: true,
                  }),
                ], { isCurrent: true }),
              ]),
            ]),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        postSendTree: postTree,
        contentEntries: [
          ["c1", "user", "msg 2"],
          ["AI_c1", "assistant", "resp 2"],
          ["c_fork", "user", "forked"],
          ["ai-response-1", "assistant", "fork resp"],
        ],
      });
      const tm = createTreeManager(mock);

      const result = await tm.handleMessage("fork here", "AI_c1", {
        forceBranch: true,
      });

      // findBranchPoint("AI_c1") → AI_c1 is already an AI node → branch from it
      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_c1");
      expect(result.response).toBe("AI response");
    });

    it("works when viewNodeId is a user node (finds AI child)", async () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      await tm.handleMessage("fork!", "p1", { forceBranch: true });

      // findBranchPoint("p1") → walks to AI_p1 → branch from AI_p1
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_p1");
    });
  });

  // ---------------------------------------------------------------------------
  // 1g. forceBranch but findBranchPoint returns null
  // ---------------------------------------------------------------------------

  describe("1g. forceBranch with nonexistent viewNodeId", () => {
    it("does not crash and does not call simpleBranch", async () => {
      const tree = [
        aUserNode("p1", "msg 1", [], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      // No crash expected — nonexistent viewNodeId
      const result = await tm.handleMessage("hello", "nonexistent", {
        forceBranch: true,
      });

      // nonexistent viewNodeId → findBranchPoint returns null → no simpleBranch
      expect(mock.simpleBranch).not.toHaveBeenCalled();
      expect(mock.sendMessage).toHaveBeenCalledWith("hello");
      expect(result.response).toBe("AI response");
    });
  });

  // ---------------------------------------------------------------------------
  // Streaming variant
  // ---------------------------------------------------------------------------

  describe("handleMessageStreaming — branching parity", () => {
    it("applies forceBranch logic identically to handleMessage", async () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const postTree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c_fork", "fork", [
                  aAINode("ai-response-1", "resp", [], { isCurrent: true }),
                ], { isCurrent: true }),
              ]),
            ]),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        postSendTree: postTree,
        contentEntries: [
          ["c_fork", "user", "fork"],
          ["ai-response-1", "assistant", "resp"],
        ],
      });
      const tm = createTreeManager(mock);

      const tokens: string[] = [];
      let doneResult: Record<string, unknown> | null = null;

      await tm.handleMessageStreaming(
        "fork streaming",
        "c1",
        {
          onToken: async (t) => { tokens.push(t); },
          onTreeUpdate: async () => {},
          onDone: async (r) => {
            doneResult = r;
          },
        },
        { forceBranch: true },
      );

      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_c1");
      expect(tokens).toEqual(["AI ", "response"]);
      expect(doneResult).toBeTruthy();
      expect((doneResult as any).response).toBe("AI response");
    });

    it("does NOT branch for linear continuation (streaming)", async () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      await tm.handleMessageStreaming(
        "keep going",
        "p1",
        {
          onToken: async () => {},
          onTreeUpdate: async () => {},
          onDone: async () => {},
        },
      );

      // No fork → pointer positioned at deepest leaf (AI_p1)
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_p1");
    });

    it("auto-branches at fork point (streaming)", async () => {
      // AI_p1 has 2 children → auto-branch
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "branch A", [
              aAINode("AI_c1", "resp A"),
            ]),
            aUserNode("c2", "branch B", [
              aAINode("AI_c2", "resp B", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      await tm.handleMessageStreaming(
        "new branch",
        "p1",
        {
          onToken: async () => {},
          onTreeUpdate: async () => {},
          onDone: async () => {},
        },
      );

      // Fork at AI_p1 (2 children) → auto-branch
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_p1");
    });

    it("resolves scope from current leaf when viewNodeId=null (streaming)", async () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
        ],
      });
      const tm = createTreeManager(mock);

      let doneResult: Record<string, unknown> | null = null;
      await tm.handleMessageStreaming(
        "hello",
        null,
        {
          onToken: async () => {},
          onTreeUpdate: async () => {},
          onDone: async (r) => {
            doneResult = r;
          },
        },
      );

      // viewNodeId=null → pointer to deepest leaf
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_p1");
      // viewNodeId=null → resolved from current leaf (AI_p1), parent = p1
      expect((doneResult as any).viewNodeId).toBe("p1");
    });
  });

  // ---------------------------------------------------------------------------
  // 1h. Message from parent scope with branched children (Bug: new node under b2)
  // ---------------------------------------------------------------------------

  describe("1h. Message from parent scope with branched children", () => {
    function buildParentWithBranchedChildren() {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "branch b1 msg", [
              aAINode("AI_c1", "branch b1 resp"),
            ]),
            aUserNode("c2", "branch b2 msg 1", [
              aAINode("AI_c2", "branch b2 resp 1", [
                aUserNode("c3", "branch b2 msg 2", [
                  aAINode("AI_c3", "branch b2 resp 2", [], { isCurrent: true }),
                ], { isCurrent: true }),
              ], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const postTree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "branch b1 msg", [
              aAINode("AI_c1", "branch b1 resp"),
            ]),
            aUserNode("c2", "branch b2 msg 1", [
              aAINode("AI_c2", "branch b2 resp 1", [
                aUserNode("c3", "branch b2 msg 2", [
                  aAINode("AI_c3", "branch b2 resp 2"),
                ]),
              ]),
            ]),
            aUserNode("c_new", "new msg from parent", [
              aAINode("ai-response-1", "new resp", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      return { tree, postTree };
    }

    it("auto-branches from parent scope when fork exists", async () => {
      const { tree } = buildParentWithBranchedChildren();
      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
        ],
      });
      const tm = createTreeManager(mock);

      // Fork at AI_p1 (2 children) → auto-branch
      await tm.handleMessage("new msg from parent", "p1");
      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_p1");
    });

    it("branches from AI_p1 with forceBranch from parent scope", async () => {
      const { tree, postTree } = buildParentWithBranchedChildren();
      const mock = createMockPiSession({
        annotatedTree: tree,
        postSendTree: postTree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["c1", "user", "branch b1 msg"],
          ["AI_c1", "assistant", "branch b1 resp"],
          ["c2", "user", "branch b2 msg 1"],
          ["AI_c2", "assistant", "branch b2 resp 1"],
          ["c3", "user", "branch b2 msg 2"],
          ["AI_c3", "assistant", "branch b2 resp 2"],
        ],
      });
      const tm = createTreeManager(mock);

      await tm.handleMessage("new msg from parent", "p1", { forceBranch: true });

      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_p1");
      expect(mock.sendMessage).toHaveBeenCalledWith("new msg from parent");
    });

    it("redirects to new branch scope after auto-branch", async () => {
      const { tree, postTree } = buildParentWithBranchedChildren();
      const mock = createMockPiSession({
        annotatedTree: tree,
        postSendTree: postTree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
        ],
      });
      const tm = createTreeManager(mock);

      const result = await tm.handleMessage("new msg from parent", "p1");
      // Auto-branch: scope redirects to the new branch so follow-ups
      // continue linearly instead of re-triggering auto-branch.
      expect(result.viewNodeId).toBe("c_new");
    });

    it("post-message state redirects to new branch after auto-branch", async () => {
      const { tree, postTree } = buildParentWithBranchedChildren();
      const mock = createMockPiSession({
        annotatedTree: tree,
        postSendTree: postTree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["c1", "user", "branch b1 msg"],
          ["AI_c1", "assistant", "branch b1 resp"],
          ["c2", "user", "branch b2 msg 1"],
          ["AI_c2", "assistant", "branch b2 resp 1"],
          ["c_new", "user", "new msg from parent"],
          ["ai-response-1", "assistant", "new resp"],
        ],
      });
      const tm = createTreeManager(mock);

      const result = await tm.handleMessage("new msg from parent", "p1");

      // Auto-branch: scope redirects to the new branch
      expect(result.viewNodeId).toBe("c_new");
    });

    it("streaming variant: branches from AI_p1 with forceBranch", async () => {
      const { tree, postTree } = buildParentWithBranchedChildren();
      const mock = createMockPiSession({
        annotatedTree: tree,
        postSendTree: postTree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["c_new", "user", "new msg from parent"],
          ["ai-response-1", "assistant", "new resp"],
        ],
      });
      const tm = createTreeManager(mock);

      let doneResult: Record<string, unknown> | null = null;
      await tm.handleMessageStreaming(
        "new msg from parent",
        "p1",
        {
          onToken: async () => {},
          onTreeUpdate: async () => {},
          onDone: async (r) => { doneResult = r; },
        },
        { forceBranch: true },
      );

      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_p1");
      expect((doneResult as any).viewNodeId).toBe("c_new");
    });
  });

  // ---------------------------------------------------------------------------
  // 1i. viewNodeId=null with existing branches (the actual bug)
  // ---------------------------------------------------------------------------

  describe("1i. viewNodeId=null with existing branched tree", () => {
    function buildTreeWithBranches() {
      return [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "branch b1 msg", [
              aAINode("AI_c1", "branch b1 resp"),
            ]),
            aUserNode("c2", "branch b2 msg 1", [
              aAINode("AI_c2", "branch b2 resp 1", [
                aUserNode("c3", "branch b2 msg 2", [
                  aAINode("AI_c3", "branch b2 resp 2", [], { isCurrent: true }),
                ], { isCurrent: true }),
              ], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];
    }

    it("auto-branches with viewNodeId=null when fork exists", async () => {
      const tree = buildTreeWithBranches();
      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
        ],
      });
      const tm = createTreeManager(mock);

      // viewNodeId=null → effectiveViewNodeId = tree root → walks to AI_p1 fork → auto-branch
      await tm.handleMessage("new msg from root", null);
      expect(mock.simpleBranch).toHaveBeenCalledOnce();
    });

    it("branches from AI_p1 with forceBranch even when viewNodeId is null", async () => {
      const tree = buildTreeWithBranches();
      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
        ],
      });
      const tm = createTreeManager(mock);

      await tm.handleMessage("new msg from root", null, { forceBranch: true });
      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_p1");
    });

    it("streaming: branches from AI_p1 with forceBranch even when viewNodeId is null", async () => {
      const tree = buildTreeWithBranches();
      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
        ],
      });
      const tm = createTreeManager(mock);

      let doneResult: Record<string, unknown> | null = null;
      await tm.handleMessageStreaming(
        "new msg from root",
        null,
        {
          onToken: async () => {},
          onTreeUpdate: async () => {},
          onDone: async (r) => { doneResult = r; },
        },
        { forceBranch: true },
      );

      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_p1");
      expect(doneResult).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Linear-only: message without forceBranch never branches
  // ---------------------------------------------------------------------------

  describe("linear-only: no auto-branching when no fork", () => {
    it("continues linearly when scope has no fork (1 child)", async () => {
      // Linear chain — AI_1 has exactly 1 child → no fork → no branch
      const tree = [
        aUserNode("u1", "msg 1", [
          aAINode("AI_1", "resp 1", [
            aUserNode("c1", "follow-up", [
              aAINode("AI_c1", "resp 2", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["u1", "user", "msg 1"],
          ["AI_1", "assistant", "resp 1"],
        ],
      });
      const tm = createTreeManager(mock);

      await tm.handleMessage("hello", "u1");

      // No fork → pointer positioned at deepest leaf (AI_c1)
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_c1");
      expect(mock.sendMessage).toHaveBeenCalledWith("hello");
    });

    it("auto-branches when scope has a fork (2+ children)", async () => {
      // AI_1 has 2 children → fork → auto-branch
      const tree = [
        aUserNode("u1", "msg 1", [
          aAINode("AI_1", "resp 1", [
            aUserNode("c1", "branch A", [
              aAINode("AI_c1", "resp A"),
            ]),
            aUserNode("c2", "branch B", [
              aAINode("AI_c2", "resp B", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["u1", "user", "msg 1"],
          ["AI_1", "assistant", "resp 1"],
        ],
      });
      const tm = createTreeManager(mock);

      await tm.handleMessage("hello", "u1");

      // Fork at AI_1 (2 children) → auto-branch
      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_1");
    });
  });

  // ---------------------------------------------------------------------------
  // 1j. Stranded SDK pointer — message in deep sub-branch after ⑂ click
  // ---------------------------------------------------------------------------
  //
  // Regression: user clicks ⑂ on branch A (SDK pointer moves to placeholder),
  // then navigates to branch B's deep sub-branch and types. Without pointer
  // repositioning, the message goes to branch A's placeholder instead of
  // continuing linearly in branch B.

  describe("1j. Stranded pointer — deep sub-branch message routing", () => {
    it("positions SDK pointer at deepest leaf of viewed branch", async () => {
      // Tree shape (reproduces the exact reported bug):
      //
      //   u1 → AI_1 (fork with 3 children)
      //     ├── u2 → AI_2 → u3 → AI_3 (branch A — main)
      //     ├── placeholder (from prior ⑂ click — stranded pointer)
      //     └── u5 → AI_5 (branch C)
      //           └── u6 → AI_6 (fork)
      //                 ├── u7 → AI_7 → u8 → AI_8 (deep sub-branch)
      //                 └── placeholder2
      //
      // User views u7 scope (test 7) and types "test 9".
      // Expected: simpleBranch("AI_8") — deepest leaf of u7's chain.
      // Bug: message went to "placeholder" (stranded from prior ⑂).

      const tree = [
        aUserNode("u1", "msg 1", [
          aAINode("AI_1", "resp 1", [
            // Branch A (main)
            aUserNode("u2", "test 2", [
              aAINode("AI_2", "resp 2", [
                aUserNode("u3", "test 3", [
                  aAINode("AI_3", "resp 3"),
                ]),
              ]),
            ]),
            // Stranded placeholder (from prior ⑂ click — SDK pointer is HERE)
            aUserNode("ph_1", "New branch", [], {
              status: "placeholder",
              isCurrent: true,
            }),
            // Branch C
            aUserNode("u5", "test 5", [
              aAINode("AI_5", "resp 5", [
                // Fork under test 5's response
                aUserNode("u6", "test 6", [
                  aAINode("AI_6", "resp 6", [
                    // Deep sub-branch (user is viewing HERE)
                    aUserNode("u7", "test 7", [
                      aAINode("AI_7", "resp 7", [
                        aUserNode("u8", "test 8", [
                          aAINode("AI_8", "resp 8"),
                        ]),
                      ]),
                    ]),
                    // Another placeholder
                    aUserNode("ph_2", "New branch", [], {
                      status: "placeholder",
                    }),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["u7", "user", "test 7"],
          ["AI_7", "assistant", "resp 7"],
          ["u8", "user", "test 8"],
          ["AI_8", "assistant", "resp 8"],
        ],
      });
      const tm = createTreeManager(mock);

      // User views u7 and sends "test 9"
      await tm.handleMessage("test 9", "u7");

      // Should position at AI_8 (deepest leaf of u7's chain), NOT ph_1
      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_8");
      expect(mock.sendMessage).toHaveBeenCalledWith("test 9");
    });

    it("positions pointer correctly for streaming variant too", async () => {
      // Same tree shape, streaming path
      const tree = [
        aUserNode("u1", "msg 1", [
          aAINode("AI_1", "resp 1", [
            aUserNode("u2", "branch a"),
            aUserNode("ph_1", "New branch", [], {
              status: "placeholder",
              isCurrent: true,
            }),
            aUserNode("u5", "branch c", [
              aAINode("AI_5", "resp 5", [
                aUserNode("u6", "deep", [
                  aAINode("AI_6", "deep resp"),
                ]),
              ]),
            ]),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      await tm.handleMessageStreaming(
        "hello",
        "u5",
        {
          onToken: async () => {},
          onTreeUpdate: async () => {},
          onDone: async () => {},
        },
      );

      // Deepest leaf from u5 is AI_6
      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_6");
    });
  });
});


describe("TreeManager — Phase 2: State Composition", () => {
  describe("getSessionState", () => {
    it("returns correct SessionState shape", () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["c1", "user", "msg 2"],
          ["AI_c1", "assistant", "resp 2"],
        ],
        breadcrumb: [{ entryId: "p1", label: "msg 1" }],
      });
      const tm = createTreeManager(mock);

      const state = tm.getSessionState("p1");

      expect(state.sessionId).toBe(1);
      expect(state.userId).toBe("test-user");
      expect(state.sourceId).toBe("test-source");
      expect(state.viewNodeId).toBe("p1");
      expect(state.tree).toBeDefined();
      expect(state.tree.id).toBe("p1");
      expect(state.messages).toBeDefined();
      expect(state.branches).toBeDefined();
      expect(state.breadcrumb).toBeDefined();
    });

    it("collects messages along the linear chain from viewNodeId", () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["c1", "user", "msg 2"],
          ["AI_c1", "assistant", "resp 2"],
        ],
      });
      const tm = createTreeManager(mock);

      const state = tm.getSessionState("p1");

      // From p1: walks p1 → AI_p1 → c1 → AI_c1 (all linear)
      expect(state.messages.length).toBe(4);
      expect(state.messages[0].id).toBe("p1");
      expect(state.messages[0].role).toBe("user");
      expect(state.messages[1].id).toBe("AI_p1");
      expect(state.messages[1].role).toBe("assistant");
      expect(state.messages[2].id).toBe("c1");
      expect(state.messages[3].id).toBe("AI_c1");
    });

    it("reports branches at fork points", () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "branch A"),
            aUserNode("c2", "branch B"),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
        ],
      });
      const tm = createTreeManager(mock);

      const state = tm.getSessionState("p1");

      // p1 → AI_p1 → fork (2 children)
      expect(state.messages.length).toBe(2); // p1, AI_p1
      expect(state.branches.length).toBe(2);
      expect(state.branches[0].nodeId).toBe("c1");
      expect(state.branches[0].label).toBe("branch A");
      expect(state.branches[1].nodeId).toBe("c2");
      expect(state.branches[1].label).toBe("branch B");
    });

    it("auto-resolves to current node when viewNodeId is null", () => {
      const tree = [
        aUserNode("p1", "msg 1", [], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [["p1", "user", "msg 1"]],
      });
      const tm = createTreeManager(mock);

      const state = tm.getSessionState(null);

      // Auto-scope resolves to the current node so sessions aren't empty on load
      expect(state.breadcrumb).toEqual([{ nodeId: "p1", label: "msg 1" }]);
      expect(state.viewNodeId).toBe("p1");
    });

    it("returns explicit root view when viewNodeId is empty string", () => {
      const tree = [
        aUserNode("p1", "msg 1", [], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [["p1", "user", "msg 1"]],
      });
      const tm = createTreeManager(mock);

      const state = tm.getSessionState("");

      // Empty string means "explicit root" — no auto-resolve, breadcrumb empty
      expect(state.breadcrumb).toEqual([]);
      expect(state.viewNodeId).toBeNull();
    });

    it("builds breadcrumb path from root to viewNodeId", () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      const state = tm.getSessionState("c1");

      // Breadcrumb: p1 → AI_p1 → c1
      expect(state.breadcrumb.length).toBe(3);
      expect(state.breadcrumb[0].nodeId).toBe("p1");
      expect(state.breadcrumb[1].nodeId).toBe("AI_p1");
      expect(state.breadcrumb[2].nodeId).toBe("c1");
    });

    it("returns empty messages for nonexistent viewNodeId", () => {
      const tree = [aUserNode("p1", "msg 1", [], { isCurrent: true })];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      const state = tm.getSessionState("nonexistent");

      expect(state.messages).toEqual([]);
      expect(state.branches).toEqual([]);
    });
  });

  describe("getTreeView", () => {
    it("returns empty tree when annotated tree is empty", () => {
      const mock = createMockPiSession({
        annotatedTree: [],
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      const tree = tm.getTreeView();

      expect(tree.id).toBe("");
      expect(tree.isCurrent).toBe(true);
      expect(tree.children).toEqual([]);
    });

    it("converts annotated tree to TreeNodeView", () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2"),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      const view = tm.getTreeView();

      expect(view.id).toBe("p1");
      expect(view.label).toBe("msg 1");
      expect(view.children.length).toBe(1);
      expect(view.children[0].id).toBe("AI_p1");
      expect(view.children[0].label).toBe("✦ resp 1");
      expect(view.children[0].children.length).toBe(1);
      expect(view.children[0].children[0].id).toBe("c1");
    });

    it("maps parentId correctly (root gets null)", () => {
      // AnnotatedTreeNode uses "root" for top-level parentId
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [], {
            parentId: "p1",
          }),
        ], { parentId: "root" }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      const view = tm.getTreeView();

      // "root" parentId → null in TreeNodeView
      expect(view.parentId).toBeNull();
      expect(view.children[0].parentId).toBe("p1");
    });
  });
});

// =============================================================================
// Phase 3: Navigation
// =============================================================================

describe("TreeManager — Phase 3: Navigation", () => {
  describe("navigateTo", () => {
    it("calls branchAt for direct navigation", async () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
        ],
      });
      const tm = createTreeManager(mock);

      const result = await tm.navigateTo("AI_p1");

      expect(mock.branchAt).toHaveBeenCalledOnce();
      expect(mock.branchAt).toHaveBeenCalledWith("AI_p1", {
        label: "Resumed",
        source: "auto",
        status: "active",
      });
      expect(result).toBeDefined();
      expect(result.tree).toBeDefined();
    });

    it("calls branchWithSummary when summarize=true", async () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      await tm.navigateTo("AI_p1", { summarize: true });

      expect(mock.branchWithSummary).toHaveBeenCalledOnce();
      expect(mock.branchWithSummary).toHaveBeenCalledWith(
        "AI_p1",
        expect.any(String),
      );
      expect(mock.branchAt).not.toHaveBeenCalled();
    });

    it("returns valid SessionState after navigation", async () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["c1", "user", "msg 2"],
          ["AI_c1", "assistant", "resp 2"],
        ],
        breadcrumb: [{ entryId: "p1", label: "msg 1" }],
      });
      const tm = createTreeManager(mock);

      const state = await tm.navigateTo("c1");

      expect(state.userId).toBe("test-user");
      expect(state.sourceId).toBe("test-source");
      expect(state.tree).toBeDefined();
      expect(state.messages).toBeDefined();
    });
  });

  describe("deleteNode", () => {
    it("calls updateStatus with 'abandoned'", () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "branch A"),
            aUserNode("c2", "branch B"),
          ]),
        ]),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      const state = tm.deleteNode("c1", "p1");

      expect(mock.updateStatus).toHaveBeenCalledWith("c1", "abandoned");
      expect(state).toBeDefined();
      expect(state.viewNodeId).toBe("p1");
    });
  });

  describe("renameNode", () => {
    it("calls updateLabel with the new name", () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      const state = tm.renameNode("p1", "New Label", null);

      expect(mock.updateLabel).toHaveBeenCalledWith("p1", "New Label");
      expect(state).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // forkAtNode — immediate fork without sending a message
  // ---------------------------------------------------------------------------

  describe("forkAtNode", () => {
    it("forks at the grandparent AI node when clicking ⑂ on an AI message", () => {
      // Tree: p1 → AI_p1 → c1 → AI_c1 → c2 → AI_c2 → c3 → AI_c3
      //                              ↑ fork HERE (grandparent AI of AI_c2)
      // User clicks ⑂ on AI_c2 → fork at AI_c1 (before c2)
      // Scope navigates to c2_user (the conversation turn the user clicked on)
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c2", "msg 3", [
                  aAINode("AI_c2", "resp 3", [
                    aUserNode("c3", "msg 4", [
                      aAINode("AI_c3", "resp 4", [], { isCurrent: true }),
                    ], { isCurrent: true }),
                  ], { isCurrent: true }),
                ], { isCurrent: true }),
              ], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["c1", "user", "msg 2"],
          ["AI_c1", "assistant", "resp 2"],
          ["c2", "user", "msg 3"],
          ["AI_c2", "assistant", "resp 3"],
          ["c3", "user", "msg 4"],
          ["AI_c3", "assistant", "resp 4"],
        ],
      });
      const tm = createTreeManager(mock);

      // User clicks ⑂ on AI_c2 (c2's AI response)
      const result = tm.forkAtNode("AI_c2");

      // Should use branchAt at AI_c1 (grandparent AI) to create structural fork
      expect(mock.branchAt).toHaveBeenCalledOnce();
      expect(mock.branchAt).toHaveBeenCalledWith("AI_c1", expect.objectContaining({
        label: "New branch",
        source: "fork",
        status: "placeholder",
      }));
      expect(mock.simpleBranch).not.toHaveBeenCalled();

      // Should not send a message
      expect(mock.sendMessage).not.toHaveBeenCalled();

      // state.viewNodeId should point to c2_user (the conversation turn clicked on)
      expect(result.state.viewNodeId).toBe("c2");

      // forkScopeId should be c1_user (parent of AI_c1 — use this for next message)
      expect(result.forkScopeId).toBe("c1");
    });

    it("forks at AI_p1 when clicking ⑂ on AI_c1 (c1's AI response)", () => {
      // Tree: p1 → AI_p1 → c1 → AI_c1 → c2 → AI_c2
      //                ↑ fork HERE (grandparent AI of AI_c1)
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [
                aUserNode("c2", "msg 3", [
                  aAINode("AI_c2", "resp 3", [], { isCurrent: true }),
                ], { isCurrent: true }),
              ], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["c1", "user", "msg 2"],
          ["AI_c1", "assistant", "resp 2"],
          ["c2", "user", "msg 3"],
          ["AI_c2", "assistant", "resp 3"],
        ],
      });
      const tm = createTreeManager(mock);

      const result = tm.forkAtNode("AI_c1");

      // Should fork at AI_p1 (grandparent AI) using branchAt
      expect(mock.branchAt).toHaveBeenCalledOnce();
      expect(mock.branchAt).toHaveBeenCalledWith("AI_p1", expect.objectContaining({
        label: "New branch",
        source: "fork",
        status: "placeholder",
      }));

      // state scoped to c1_user (the clicked conversation turn)
      expect(result.state.viewNodeId).toBe("c1");
      // forkScopeId = p1 (parent of AI_p1)
      expect(result.forkScopeId).toBe("p1");
    });

    it("falls back to the node itself when no grandparent AI exists (root level)", () => {
      // Tree: c1 → AI_c1 → c2 → AI_c2
      // Clicking ⑂ on AI_c1 — c1 has no parent AI node
      const tree = [
        aUserNode("c1", "msg 1", [
          aAINode("AI_c1", "resp 1", [
            aUserNode("c2", "msg 2", [
              aAINode("AI_c2", "resp 2", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["c1", "user", "msg 1"],
          ["AI_c1", "assistant", "resp 1"],
          ["c2", "user", "msg 2"],
          ["AI_c2", "assistant", "resp 2"],
        ],
      });
      const tm = createTreeManager(mock);

      const result = tm.forkAtNode("AI_c1");

      // No grandparent AI → fallback to branchAt on the node itself
      expect(mock.branchAt).toHaveBeenCalledOnce();
      expect(mock.branchAt).toHaveBeenCalledWith("AI_c1", expect.objectContaining({
        label: "New branch",
        source: "fork",
        status: "placeholder",
      }));
      expect(result.state).toBeDefined();
      // forkScopeId = c1 (parent of AI_c1, since AI_c1 was the fallback fork point)
      expect(result.forkScopeId).toBe("c1");
    });

    it("does not crash and skips simpleBranch for nonexistent nodeId", () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [],
      });
      const tm = createTreeManager(mock);

      const result = tm.forkAtNode("nonexistent");

      expect(mock.branchAt).not.toHaveBeenCalled();
      expect(mock.simpleBranch).not.toHaveBeenCalled();
      expect(result.state).toBeDefined();
      expect(result.forkScopeId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Full fork-then-continue: forceBranch → returned viewNodeId → linear
  // ---------------------------------------------------------------------------
  //
  // Regression test for the reported bug:
  //
  //   1. User has a linear conversation: p1 → AI_p1 → c1 → AI_c1
  //   2. User clicks ⑂ on AI_c1 → fork creates placeholder under AI_p1
  //   3. User sends message with forceBranch from p1 (forkScopeId)
  //      → new branch created → server returns viewNodeId = c_new
  //   4. User sends ANOTHER message from c_new (no forceBranch)
  //      → MUST continue linearly, NOT auto-branch
  //
  // The bug was: the client's viewNodeId ref was stale after forceBranch,
  // causing subsequent messages to be sent from the wrong scope or to
  // trigger needsAutoBranch because the scope contained the fork.

  describe("fork-then-continue: no auto-branch after explicit fork", () => {
    it("continues linearly from forceBranch's returned viewNodeId", async () => {
      // Step 1: Tree after forceBranch created the new branch.
      // AI_p1 has 2 children (fork): c1 (original) + c_new (from forceBranch).
      // The current leaf is the AI response in the new branch.
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2"),
            ]),
            aUserNode("c_new", "forked msg", [
              aAINode("AI_new", "fork resp", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["c_new", "user", "forked msg"],
          ["AI_new", "assistant", "fork resp"],
        ],
      });
      const tm = createTreeManager(mock);

      // Step 2: Continue from c_new (the viewNodeId returned by forceBranch).
      // This should NOT auto-branch — the subtree from c_new is purely linear.
      await tm.handleMessage("continue in fork", "c_new");

      // Verify: simpleBranch positioned at deepest leaf of c_new chain (AI_new)
      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_new");
      expect(mock.sendMessage).toHaveBeenCalledWith("continue in fork");
    });

    it("continues linearly in streaming variant", async () => {
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2"),
            ]),
            aUserNode("c_new", "forked msg", [
              aAINode("AI_new", "fork resp", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["c_new", "user", "forked msg"],
          ["AI_new", "assistant", "fork resp"],
        ],
      });
      const tm = createTreeManager(mock);

      let doneResult: Record<string, unknown> | null = null;
      await tm.handleMessageStreaming(
        "continue in fork",
        "c_new",
        {
          onToken: async () => {},
          onTreeUpdate: async () => {},
          onDone: async (r) => { doneResult = r; },
        },
      );

      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_new");
      // viewNodeId stays at c_new (no redirect for non-forceBranch)
      expect((doneResult as any).viewNodeId).toBe("c_new");
    });

    it("stays linear even after multiple messages in the fork", async () => {
      // Tree after 2 messages in the fork: c_new → AI_new → c_next → AI_next
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2"),
            ]),
            aUserNode("c_new", "forked msg", [
              aAINode("AI_new", "fork resp", [
                aUserNode("c_next", "second msg", [
                  aAINode("AI_next", "second resp", [], { isCurrent: true }),
                ], { isCurrent: true }),
              ], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["c_new", "user", "forked msg"],
          ["AI_new", "assistant", "fork resp"],
          ["c_next", "user", "second msg"],
          ["AI_next", "assistant", "second resp"],
        ],
      });
      const tm = createTreeManager(mock);

      // Third message from c_new scope — should walk to AI_next (deepest leaf)
      await tm.handleMessage("third msg", "c_new");

      expect(mock.simpleBranch).toHaveBeenCalledOnce();
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_next");
    });

    it("auto-branches only from the fork-containing scope (p1), not from inside (c_new)", async () => {
      // Same tree as above, but sending from p1 (parent scope with fork)
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2"),
            ]),
            aUserNode("c_new", "forked msg", [
              aAINode("AI_new", "fork resp", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
        ],
      });
      const tm = createTreeManager(mock);

      // From p1 scope: AI_p1 has 2 children (c1 + c_new) → auto-branch
      await tm.handleMessage("from parent", "p1");
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_p1");

      // From c_new scope: AI_new has 0 children → linear
      mock.simpleBranch.mockClear();
      mock.sendMessage.mockClear();
      await tm.handleMessage("from fork", "c_new");
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_new");
    });

    it("handles nested forks at multiple levels correctly", async () => {
      // Tree: p1 → AI_p1 → [u2a → AI_2a → [u3a → AI_3a, u3b → AI_3b], u2b → AI_2b]
      //
      // AI_p1 has 2 children (u2a, u2b) → outer fork
      // AI_2a has 2 children (u3a, u3b) → inner fork
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("u2a", "msg 2a", [
              aAINode("AI_2a", "resp 2a", [
                aUserNode("u3a", "msg 3a", [
                  aAINode("AI_3a", "resp 3a", [], { isCurrent: true }),
                ], { isCurrent: true }),
                aUserNode("u3b", "msg 3b", [
                  aAINode("AI_3b", "resp 3b"),
                ]),
              ], { isCurrent: true }),
            ], { isCurrent: true }),
            aUserNode("u2b", "msg 2b", [
              aAINode("AI_2b", "resp 2b"),
            ]),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["u2a", "user", "msg 2a"],
          ["AI_2a", "assistant", "resp 2a"],
          ["u3a", "user", "msg 3a"],
          ["AI_3a", "assistant", "resp 3a"],
          ["u3b", "user", "msg 3b"],
          ["AI_3b", "assistant", "resp 3b"],
          ["u2b", "user", "msg 2b"],
          ["AI_2b", "assistant", "resp 2b"],
        ],
      });
      const tm = createTreeManager(mock);

      // From u2a: AI_2a has 2 children (u3a, u3b) → auto-branch at inner fork
      await tm.handleMessage("msg from u2a", "u2a");
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_2a");

      // Reset
      mock.simpleBranch.mockClear();
      mock.sendMessage.mockClear();

      // From p1: AI_p1 has 2 children (u2a, u2b) → auto-branch at outer fork
      await tm.handleMessage("msg from p1", "p1");
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_p1");
    });

    it("routes correctly when viewNodeId is an AI node (not a user node)", async () => {
      // Tree: p1 → AI_p1 → c1 → AI_c1
      // User passes AI_c1 as viewNodeId
      const tree = [
        aUserNode("p1", "msg 1", [
          aAINode("AI_p1", "resp 1", [
            aUserNode("c1", "msg 2", [
              aAINode("AI_c1", "resp 2", [], { isCurrent: true }),
            ], { isCurrent: true }),
          ], { isCurrent: true }),
        ], { isCurrent: true }),
      ];

      const mock = createMockPiSession({
        annotatedTree: tree,
        contentEntries: [
          ["p1", "user", "msg 1"],
          ["AI_p1", "assistant", "resp 1"],
          ["c1", "user", "msg 2"],
          ["AI_c1", "assistant", "resp 2"],
        ],
      });
      const tm = createTreeManager(mock);

      // Should not crash; AI_c1 is a valid node.
      // findBranchPoint("AI_c1") returns "AI_c1" itself (isAINode → true).
      // needsAutoBranch walks from AI_c1: 0 children → linear → no auto-branch.
      // Falls through to findDeepestLeaf("AI_c1") → "AI_c1" (leaf).
      const result = await tm.handleMessage("msg", "AI_c1");

      // simpleBranch should be called with "AI_c1" (deepest leaf = itself)
      expect(mock.simpleBranch).toHaveBeenCalledWith("AI_c1");
      expect(mock.sendMessage).toHaveBeenCalledWith("msg");
      expect(result.response).toBe("AI response");
      // viewNodeId stays at AI_c1 (no forceBranch, no redirect)
      expect(result.viewNodeId).toBe("AI_c1");
    });
  });
});
