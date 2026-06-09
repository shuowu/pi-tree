import { describe, it, expect } from "vitest";
import type { TreeNodeView } from "@pi-tree/shared";
import { buildTooltip } from "../tree-utils";

/** Shorthand to build a TreeNodeView */
function makeNode(label: string, summary?: string): TreeNodeView {
  return {
    id: "test",
    parentId: null,
    label,
    status: "active",
    messageCount: 0,
    children: [],
    isCurrent: false,
    summary,
  };
}

describe("buildTooltip", () => {
  it("returns undefined for short labels without summary", () => {
    expect(buildTooltip(makeNode("Short"))).toBeUndefined();
    expect(buildTooltip(makeNode("Under forty chars"))).toBeUndefined();
  });

  it("returns undefined for labels exactly at threshold (39 chars)", () => {
    const label39 = "a".repeat(39);
    expect(buildTooltip(makeNode(label39))).toBeUndefined();
  });

  it("returns tooltip for labels at 40+ chars", () => {
    const label40 = "a".repeat(40);
    expect(buildTooltip(makeNode(label40))).toBe(label40);
  });

  it("returns full label when between 40 and 200 chars", () => {
    const label = "a".repeat(100);
    expect(buildTooltip(makeNode(label))).toBe(label);
  });

  it("truncates labels over 200 chars with ellipsis", () => {
    const label = "a".repeat(300);
    const tooltip = buildTooltip(makeNode(label))!;
    expect(tooltip).toHaveLength(201); // 200 + "…"
    expect(tooltip.endsWith("…")).toBe(true);
    expect(tooltip.startsWith("a".repeat(200))).toBe(true);
  });

  it("shows tooltip for short label when summary exists", () => {
    const tip = buildTooltip(makeNode("Short", "Some summary"))!;
    expect(tip).toBe("Short\n—\nSome summary");
  });

  it("appends summary on new line with separator", () => {
    const label = "a".repeat(50);
    const summary = "This is a summary";
    const tip = buildTooltip(makeNode(label, summary))!;
    expect(tip).toContain("\n—\n");
    expect(tip).toBe(label + "\n—\n" + summary);
  });

  it("truncates summary over 150 chars", () => {
    const label = "a".repeat(50);
    const summary = "b".repeat(200);
    const tip = buildTooltip(makeNode(label, summary))!;
    const parts = tip.split("\n—\n");
    expect(parts[1]).toHaveLength(151); // 150 + "…"
    expect(parts[1].endsWith("…")).toBe(true);
  });

  it("handles both label and summary truncation", () => {
    const label = "a".repeat(300);
    const summary = "b".repeat(200);
    const tip = buildTooltip(makeNode(label, summary))!;
    const parts = tip.split("\n—\n");
    expect(parts[0]).toHaveLength(201); // 200 + "…"
    expect(parts[1]).toHaveLength(151); // 150 + "…"
  });

  it("handles AI node labels (✦ prefix)", () => {
    const tip = buildTooltip(makeNode("✦ " + "a".repeat(50)))!;
    expect(tip.startsWith("✦")).toBe(true);
  });

  it("handles empty summary (no append)", () => {
    const label = "a".repeat(50);
    const tip = buildTooltip(makeNode(label, ""))!;
    // Empty summary should not add separator
    // Note: empty string is falsy so summary check fails
    expect(tip).toBe(label);
  });
});
