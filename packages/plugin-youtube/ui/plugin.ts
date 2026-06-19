import type { ClientPlugin } from "@pi-tree/ui";
import { YouTubeContentPanel } from "./ContentPanel.js";
import { YouTubeAddSourceForm } from "./YouTubeAddSourceForm.js";
import { YouTubeSourceCard } from "./YouTubeSourceCard.js";

/** YouTube plugin — contributes embedded video player + URL-based add-source form */
export function youtubePlugin(): ClientPlugin {
  return {
    sourceType: "youtube",
    contentPanel: YouTubeContentPanel,
    addSourceForm: YouTubeAddSourceForm,
    sourceCard: YouTubeSourceCard,
  };
}
