import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), run: vi.fn() } }));

import { InlineBranches } from "../InlineBranches.js";
import type { BranchOption } from "@pi-tree/core/types";

const makeBranch = (overrides?: Partial<BranchOption>): BranchOption => ({
  nodeId: "branch-1",
  label: "Test Branch",
  messageCount: 3,
  status: "active",
  ...overrides,
});

const baseProps = {
  onDrillDown: vi.fn(),
  bookId: "test-book",
  sessionId: 1 as number | null,
  newBranchIds: new Set<string>(),
  userId: "test-user",
};

describe("InlineBranches", () => {
  // ── Branch count label ──────────────────────────────────────────────

  it("renders plural branch label for multiple branches", () => {
    const branches = [makeBranch({ nodeId: "b1" }), makeBranch({ nodeId: "b2" })];
    render(<InlineBranches {...baseProps} branches={branches} />);
    expect(screen.getByText(/2 branches/)).toBeInTheDocument();
  });

  it("renders singular branch label for one branch", () => {
    render(<InlineBranches {...baseProps} branches={[makeBranch()]} />);
    expect(screen.getByText(/1 branch$/)).toBeInTheDocument();
  });

  // ── Branch labels & badges ──────────────────────────────────────────

  it("renders branch labels", () => {
    const branches = [
      makeBranch({ nodeId: "b1", label: "Alpha" }),
      makeBranch({ nodeId: "b2", label: "Beta" }),
    ];
    render(<InlineBranches {...baseProps} branches={branches} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("shows message count badge when messageCount > 0", () => {
    render(<InlineBranches {...baseProps} branches={[makeBranch({ messageCount: 5 })]} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("hides message count badge when messageCount is 0", () => {
    render(<InlineBranches {...baseProps} branches={[makeBranch({ messageCount: 0 })]} />);
    expect(screen.getByText("Test Branch")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  // ── Collapse/expand ─────────────────────────────────────────────────

  it("branches start collapsed by default — no content div", () => {
    render(<InlineBranches {...baseProps} branches={[makeBranch()]} />);
    expect(document.querySelector(".pit-inline-branch-content")).not.toBeInTheDocument();
  });

  it("new branches start expanded", () => {
    const newIds = new Set(["branch-1"]);
    render(
      <InlineBranches {...baseProps} branches={[makeBranch()]} newBranchIds={newIds} />,
    );
    expect(document.querySelector(".pit-inline-branch-content")).toBeInTheDocument();
  });

  it("toggle expand/collapse works", () => {
    render(<InlineBranches {...baseProps} branches={[makeBranch()]} />);
    expect(document.querySelector(".pit-inline-branch-content")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(document.querySelector(".pit-inline-branch-content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(document.querySelector(".pit-inline-branch-content")).not.toBeInTheDocument();
  });

  // ── Open button ─────────────────────────────────────────────────────

  it("Open button calls onDrillDown with nodeId", () => {
    const onDrillDown = vi.fn();
    render(
      <InlineBranches {...baseProps} onDrillDown={onDrillDown} branches={[makeBranch({ nodeId: "xyz" })]} />,
    );
    fireEvent.click(screen.getByText("Open →"));
    expect(onDrillDown).toHaveBeenCalledWith("xyz");
  });

  // ── Preview fetch ───────────────────────────────────────────────────

  it("shows user and AI messages after preview fetch", async () => {
    const fetchPreview = vi.fn().mockResolvedValue({
      messages: [
        { id: "m1", role: "user", content: "User question", timestamp: "" },
        { id: "m2", role: "assistant", content: "AI answer here", timestamp: "" },
      ],
      branches: [],
    });

    const newIds = new Set(["branch-1"]);
    await act(async () => {
      render(
        <InlineBranches
          {...baseProps}
          branches={[makeBranch()]}
          newBranchIds={newIds}
          fetchBranchPreview={fetchPreview}
        />,
      );
    });

    expect(await screen.findByText("User question")).toBeInTheDocument();
    expect(await screen.findByText("AI answer here")).toBeInTheDocument();
  });

  // ── Sub-branch filtering ────────────────────────────────────────────

  it("sub-branches filter out empty placeholders", async () => {
    const fetchPreview = vi.fn().mockResolvedValue({
      messages: [
        { id: "m1", role: "user", content: "Q", timestamp: "" },
      ],
      branches: [
        { nodeId: "sub-1", label: "Visible Sub", messageCount: 2, status: "active" },
        { nodeId: "sub-2", label: "Hidden Placeholder", messageCount: 0, status: "placeholder" },
      ],
    });

    const newIds = new Set(["branch-1"]);
    await act(async () => {
      render(
        <InlineBranches
          {...baseProps}
          branches={[makeBranch()]}
          newBranchIds={newIds}
          fetchBranchPreview={fetchPreview}
        />,
      );
    });

    expect(await screen.findByText("Visible Sub")).toBeInTheDocument();
    expect(screen.queryByText("Hidden Placeholder")).not.toBeInTheDocument();
  });
});
