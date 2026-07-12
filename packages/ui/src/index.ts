// Components
export { ChatView } from "./ChatView.js";
export { MessageBubble } from "./MessageBubble.js";
export { StreamingBubble } from "./StreamingBubble.js";
export { InlineBranches, type BranchPreviewData } from "./InlineBranches.js";
export { Breadcrumb } from "./Breadcrumb.js";
export { ToolCallIndicator } from "./ToolCallIndicator.js";
export { ToolSteps } from "./ToolSteps.js";
export { ModelPicker, type ModelInfo } from "./ModelPicker.js";
export { SelectionToolbar } from "./SelectionToolbar.js";
export { SlashCommandMenu, type SlashCommand, type SlashCommandResult } from "./SlashCommandMenu.js";
export { SourceCardMenu, FinishedBadge, type SourceCardMenuProps } from "./SourceCardMenu.js";

// Hooks
export { useMermaid } from "./hooks/useMermaid.js";
export { useScrollDirection, type ScrollDirection } from "./hooks/useScrollDirection.js";

// Types — shared contract for plugin content panels
export type { ContentPanelProps, AddSourceFormProps, SourceCardProps, SourceItemsPanelProps, SourcePanelDef, ClientPlugin } from "./types.js";
