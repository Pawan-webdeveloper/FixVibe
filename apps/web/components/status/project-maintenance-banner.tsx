/*
 * Project-level maintenance banner on the public status page.
 *
 * The per-component maintenance windows (rendered inside each
 * <ComponentCard>) are for a single monitor going offline for a known
 * reason. THIS banner is for a project-wide outage the owner has
 * scheduled — the visitor sees it once, at the top, with a single
 * description, instead of one banner per monitor.
 *
 * Today the active window list comes pre-aggregated from the page
 * (one entry per currently-active window). When the query layer is
 * extended to summarise windows per project, this component stays the
 * same — it just renders fewer rows.
 */

import type { PublicMaintenanceWindow } from '@scanlyfix/db'
import { hasActiveMaintenance } from './status-polish-helpers'

interface ProjectMaintenanceBannerProps {
  windows: ReadonlyArray<PublicMaintenanceWindow>
}

export function ProjectMaintenanceBanner({ windows }: ProjectMaintenanceBannerProps) {
  if (windows.length === 0) return null

  return (
    <section
      role="status"
      data-testid="project-maintenance-banner"
      aria-label="Scheduled maintenance"
      className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 text-amber-500">
          🔧
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-700">
            Scheduled maintenance in progress
          </p>
          {windows.length === 1 ? (
            <SingleMaintenanceDescription window={windows[0]!} />
          ) : (
            <ul className="mt-1 space-y-1 text-sm text-amber-700/80">
              {windows.map((w, i) => (
                <li key={i}>
                  <SingleMaintenanceDescription window={w} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function SingleMaintenanceDescription({ window: w }: { window: PublicMaintenanceWindow }) {
  return (
    <p className="mt-0.5 text-sm text-amber-700/80">
      {w.description}
      {w.reason && (
        <span className="text-amber-700/60"> — {w.reason}</span>
      )}
    </p>
  )
}
