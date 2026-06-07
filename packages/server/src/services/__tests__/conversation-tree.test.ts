/**
 * Tests for PiSession.buildConversationNode — parasitic internal entry handling.
 *
 * When appendCustomEntry is used for rename/delete metadata, it appends a
 * custom entry as a child of the current conversation leaf.  The raw Pi tree
 * then looks like:
 *
 *   ... → assistant_msg → custom_entry (label/status metadata)
 *
 * buildConversationNode should treat the assistant_msg as a leaf because
 * all its children are internal (non-message) entries.
 *
 * Since buildConversationNode is private, we test via a minimal mock of
 * the SessionTreeNode structure and the exported buildConversationTree helper.
 */

import { describe, it, expect } from "vitest";
import {
  shouldShowAssistantNode,
  type AssistantNodeContext,
} from "../conversation-tree";

// ─── shouldShowAssistantNode — extracted from buildConversationNode ──────────

describe("shouldShowAssistantNode", () => {
  it("leaf node (no raw children) → show as active leaf", () => {
    const ctx: AssistantNodeContext = {
      rawChildCount: 0,
      meaningfulChildren: [],
    };
    const result = shouldShowAssistantNode(ctx);
    expect(result.show).toBe(true);
    expect(result.status).toBe("active");
  });

  it("has user-initiated children → show as completed (final response)", () => {
    const ctx: AssistantNodeContext = {
      rawChildCount: 1,
      meaningfulChildren: [
        { source: "user", entryId: "u1", label: "Follow-up" },
      ],
    };
    const result = shouldShowAssistantNode(ctx);
    expect(result.show).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("multiple meaningful children → show as branch point", () => {
    const ctx: AssistantNodeContext = {
      rawChildCount: 2,
      meaningfulChildren: [
        { source: "user", entryId: "u1", label: "Branch A" },
        { source: "user", entryId: "u2", label: "Branch B" },
      ],
    };
    const result = shouldShowAssistantNode(ctx);
    expect(result.show).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("single non-user child → flatten (pass through)", () => {
    const ctx: AssistantNodeContext = {
      rawChildCount: 1,
      meaningfulChildren: [
        { source: "auto", entryId: "a1", label: "Auto" },
      ],
    };
    const result = shouldShowAssistantNode(ctx);
    expect(result.show).toBe(false);
    expect(result.flatten).toBe(true);
  });

  // ─── THE BUG SCENARIO ─────────────────────────────────────────────────────
  // Raw children > 0 but all resolve to null (internal/custom entries only).
  // Before fix: this fell through all conditions → returned null → entire
  // conversation chain collapsed.
  // After fix: treated as a leaf (same as rawChildCount === 0).

  it("BUG FIX: raw children but zero meaningful children → treat as leaf", () => {
    const ctx: AssistantNodeContext = {
      rawChildCount: 1,        // has a custom entry child (from rename/delete)
      meaningfulChildren: [],   // but it resolves to nothing meaningful
    };
    const result = shouldShowAssistantNode(ctx);
    expect(result.show).toBe(true);
    expect(result.status).toBe("active"); // treated as leaf → active
  });

  it("BUG FIX: multiple raw children all internal → still treat as leaf", () => {
    const ctx: AssistantNodeContext = {
      rawChildCount: 3,        // multiple custom/label/status entries
      meaningfulChildren: [],   // none resolve to conversation nodes
    };
    const result = shouldShowAssistantNode(ctx);
    expect(result.show).toBe(true);
    expect(result.status).toBe("active");
  });

  it("BUG FIX: mix of internal and user children → show (final response)", () => {
    const ctx: AssistantNodeContext = {
      rawChildCount: 3,        // 2 internal + 1 user
      meaningfulChildren: [
        { source: "user", entryId: "u1", label: "Real follow-up" },
      ],
    };
    const result = shouldShowAssistantNode(ctx);
    expect(result.show).toBe(true);
    expect(result.status).toBe("completed"); // has user child → completed
  });
});
