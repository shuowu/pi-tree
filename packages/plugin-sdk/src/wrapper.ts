import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiTreeServices } from "./types.js";

const GLOBAL_KEY = "__piTreeServices";

/**
 * Define a pi-tree extension with typed access to pi-tree services.
 *
 * The returned function is a standard Pi SDK extension entry point.
 * When loaded outside pi-tree (e.g., in pi CLI), it gracefully no-ops.
 *
 * @example
 * ```typescript
 * import { definePiTreeExtension } from "@pi-tree/plugin-sdk";
 * import { Type } from "typebox";
 *
 * export default definePiTreeExtension((pi, services) => {
 *   pi.registerTool({
 *     name: "my_tool",
 *     label: "My Tool",
 *     description: "Does something with pi-tree sources",
 *     parameters: Type.Object({}),
 *     async execute() {
 *       const books = services.sources.list({ type: "book" });
 *       return {
 *         content: [{ type: "text", text: JSON.stringify(books) }],
 *         details: {},
 *       };
 *     },
 *   });
 * });
 * ```
 */
export function definePiTreeExtension(
  factory: (pi: ExtensionAPI, services: PiTreeServices) => void,
): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    const services = (globalThis as any)[GLOBAL_KEY] as
      | PiTreeServices
      | undefined;
    if (!services) {
      // Running outside pi-tree (e.g., in pi CLI) — skip gracefully
      return;
    }
    factory(pi, services);
  };
}
