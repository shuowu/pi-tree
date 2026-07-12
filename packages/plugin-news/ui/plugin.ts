import type { ClientPlugin } from "@pi-tree/ui";
import { NewsDashboardPanel } from "./NewsDashboardPanel.js";
import { NewsAddSourceForm } from "./NewsAddSourceForm.js";
import { NewsSourceCard } from "./NewsSourceCard.js";
import { NewsItemsPanel } from "./NewsItemsPanel.js";
import { NewsFeedsPanel } from "./NewsFeedsPanel.js";

/** News plugin — contributes a dashboard content panel and add-source info */
export function newsPlugin(): ClientPlugin {
  return {
    sourceType: "news",
    contentPanel: NewsDashboardPanel,
    addSourceForm: NewsAddSourceForm,
    sourceCard: NewsSourceCard,
    sourcePanels: [
      { key: "latest", label: "Latest", component: NewsItemsPanel },
      { key: "feeds", label: "Feeds", component: NewsFeedsPanel },
    ],
  };
}
