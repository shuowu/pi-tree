import type { PiTreeServices } from "./types.js";

const GLOBAL_KEY = "__piTreeServices";

/**
 * Get pi-tree services if available.
 *
 * Returns null when running outside pi-tree (e.g., in pi CLI).
 * Use this for hybrid extensions that optionally enhance when inside pi-tree.
 *
 * @example
 * ```typescript
 * import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
 * import { getPiTreeServices } from "@pi-tree/plugin-sdk";
 *
 * export default function(pi: ExtensionAPI) {
 *   const services = getPiTreeServices();
 *   if (services) {
 *     // pi-tree specific tools
 *   }
 *   // Tools that work everywhere
 * }
 * ```
 */
export function getPiTreeServices(): PiTreeServices | null {
  return (
    ((globalThis as any)[GLOBAL_KEY] as PiTreeServices | undefined) ?? null
  );
}
