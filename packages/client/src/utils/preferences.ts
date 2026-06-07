/**
 * Client-side preferences — localStorage-backed settings.
 *
 * All keys follow the `pi-books-*` naming convention, consistent
 * with UserContext's `pi-books-user-id` and `pi-books-display-name`.
 *
 * Add new preferences here rather than scattering localStorage calls
 * across components.
 */

// ─── Keys ───────────────────────────────────────────────────────────────────

const LS_BRANCHES_COLLAPSED = "pi-books-branches-collapsed";

// ─── Branch Previews ────────────────────────────────────────────────────────

/** Whether inline branch previews default to collapsed (default: true). */
export function getBranchesCollapsed(): boolean {
  const val = localStorage.getItem(LS_BRANCHES_COLLAPSED);
  return val === null ? true : val === "true";
}

export function setBranchesCollapsed(collapsed: boolean): void {
  localStorage.setItem(LS_BRANCHES_COLLAPSED, String(collapsed));
}
