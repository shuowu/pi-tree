/**
 * Message and custom entry types for Pi session integration.
 */

import type { ContentAnchor } from "./tree.js";

// ---------------------------------------------------------------------------
// Custom entry types stored in Pi session
// ---------------------------------------------------------------------------

export interface TopicMeta {
  kind: "topic_node";
  label: string;
  source: "outline" | "user" | "auto" | "fork";
  contentAnchor?: ContentAnchor;
  status: "active" | "completed" | "abandoned" | "placeholder";
}

export interface SectionStatusMeta {
  kind: "section_status";
  targetEntryId: string;
  newStatus: "active" | "completed" | "abandoned";
}

export interface SectionLabelMeta {
  kind: "section_label";
  targetEntryId: string;
  newLabel: string;
}

export type PiTreeData = TopicMeta | SectionStatusMeta | SectionLabelMeta;

// ---------------------------------------------------------------------------
// Annotated tree node (Pi tree + our metadata)
// ---------------------------------------------------------------------------

export interface AnnotatedTreeNode {
  entryId: string;
  parentId: string;
  label: string;
  source: "outline" | "user" | "auto" | "fork";
  status: "active" | "completed" | "abandoned" | "placeholder";
  contentAnchor?: ContentAnchor;
  messageCount: number;
  isCurrent: boolean;
  summary?: string;
  children: AnnotatedTreeNode[];
}
