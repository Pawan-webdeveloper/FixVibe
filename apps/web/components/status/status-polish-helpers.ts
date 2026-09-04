/**
 * Pure helpers shared by the public status-page components.
 *
 * Kept in a `.ts` file (no JSX) so the tests under
 * `apps/web/test/status-polish-helpers.test.ts` can import them
 * without pulling in a JSX transformer.
 */

/**
 * The most-recent check "X ago" formatter. Mirrors what `timeAgo()` did
 * inline inside status-header.tsx; extracted so it lives next to the
 * other pure helpers and so the format is a single source of truth.
 */
export function formatLastUpdated(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

import type { PublicMaintenanceWindow } from '@scanlyfix/db'

/**
 * Returns true when at least one window is active. Pure — the
 * `<ProjectMaintenanceBanner />` calls it to decide whether to render.
 */
export function hasActiveMaintenance(
  windows: ReadonlyArray<PublicMaintenanceWindow>,
): boolean {
  return windows.length > 0
}
