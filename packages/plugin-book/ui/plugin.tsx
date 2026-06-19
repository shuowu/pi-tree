import type { ClientPlugin, ContentPanelProps } from "@pi-tree/ui";
import { ContentPanel, type ContentHeading } from "./ContentPanel.js";
import { BookAddSourceForm } from "./BookAddSourceForm.js";
import { BookSourceCard } from "./BookSourceCard.js";

// ---------------------------------------------------------------------------
// Data fetching — self-contained, no @pi-tree/client imports
// ---------------------------------------------------------------------------

async function fetchHeadings(sourceId: string): Promise<ContentHeading[]> {
  const res = await fetch(`/api/library/sources/${sourceId}/headings`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.headings ?? [];
}

async function fetchContent(
  sourceId: string,
  startLine: number,
  endLine: number,
): Promise<string> {
  const res = await fetch(
    `/api/library/sources/${sourceId}/content?start=${startLine}&end=${endLine}`,
  );
  if (!res.ok) throw new Error("Failed to fetch content");
  const data = await res.json();
  return data.content;
}

// ---------------------------------------------------------------------------
// Adapter — injects fetch callbacks into the pure component
// ---------------------------------------------------------------------------

function BookContentPanel(props: ContentPanelProps) {
  return (
    <ContentPanel
      {...props}
      fetchHeadings={fetchHeadings}
      fetchContent={fetchContent}
    />
  );
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

/** Book plugin — contributes a TOC/content panel and add-source form */
export function bookPlugin(): ClientPlugin {
  return {
    sourceType: "book",
    contentPanel: BookContentPanel,
    addSourceForm: BookAddSourceForm,
    sourceCard: BookSourceCard,
  };
}
