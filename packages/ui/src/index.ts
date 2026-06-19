// Components
export { ChatView } from "./ChatView.js";
export { MessageBubble } from "./MessageBubble.js";
export { StreamingBubble } from "./StreamingBubble.js";
export { InlineBranches, type BranchPreviewData } from "./InlineBranches.js";
export { Breadcrumb } from "./Breadcrumb.js";
export { ToolCallIndicator } from "./ToolCallIndicator.js";
export { ModelPicker, type ModelInfo } from "./ModelPicker.js";
export { SelectionToolbar } from "./SelectionToolbar.js";

// Hooks
export { useMermaid } from "./hooks/useMermaid.js";
export { useScrollDirection, type ScrollDirection } from "./hooks/useScrollDirection.js";

// Types — shared contract for plugin content panels
export type { ContentPanelProps, AddSourceFormProps, SourceCardProps, ClientPlugin } from "./types.js";
