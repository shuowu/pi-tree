/**
 * Client-side preferences — localStorage-backed settings.
 *
 * All keys follow the `pi-tree-*` naming convention, consistent
 * with UserContext's `pi-tree-user-id` and `pi-tree-display-name`.
 *
 * Add new preferences here rather than scattering localStorage calls
 * across components.
 */

// ─── Keys ───────────────────────────────────────────────────────────────────

const LS_BRANCHES_COLLAPSED = "pi-tree-branches-collapsed";
const LS_SHOW_USAGE = "pi-tree-show-usage";

// ─── Branch Previews ────────────────────────────────────────────────────────

/** Whether inline branch previews default to collapsed (default: true). */
export function getBranchesCollapsed(): boolean {
  const val = localStorage.getItem(LS_BRANCHES_COLLAPSED);
  return val === null ? true : val === "true";
}

export function setBranchesCollapsed(collapsed: boolean): void {
  localStorage.setItem(LS_BRANCHES_COLLAPSED, String(collapsed));
}

// ─── Usage Badge ────────────────────────────────────────────────────────────

/** Whether the session usage badge is visible (default: false — opt-in). */
export function getShowUsage(): boolean {
  return localStorage.getItem(LS_SHOW_USAGE) === "true";
}

export function setShowUsage(show: boolean): void {
  localStorage.setItem(LS_SHOW_USAGE, String(show));
}
