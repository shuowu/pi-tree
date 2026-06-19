import type { LucideIcon } from "lucide-react";
import * as LucideIcons from "lucide-react";

/**
 * Resolve a kebab-case icon name (e.g. "book-open") to a LucideIcon component.
 * Returns the given `fallback` icon (default: Puzzle) when the name is missing
 * or doesn't match any known Lucide icon.
 */
export function resolveIcon(
  name?: string,
  fallback: LucideIcon = LucideIcons.Puzzle,
): LucideIcon {
  if (!name) return fallback;
  const pascal = name
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  return (LucideIcons as Record<string, LucideIcon>)[pascal] ?? fallback;
}
