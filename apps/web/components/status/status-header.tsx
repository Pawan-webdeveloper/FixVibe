/*
 * Top section of the public status page.
 *
 * Shows the PROJECT-LEVEL overall status — worst-of across all components.
 * The per-component dots + strips live in <ComponentCard>.
 *
 * Phase 6.4 polish:
 *   - Optional project logo + brand colour from the project's settings.
 *   - The brand colour tints the status dot + the border of the status
 *     banner when present. Default (no brand colour) keeps the clean
 *     emerald/red/gray theme.
 *   - "Last updated X ago" with a manual refresh button.
 *
 * No client JS in this file — the refresh control is a small wrapper
 * component imported alongside.
 */

type OverallStatus = 'ok' | 'failed' | 'unknown'

export interface StatusHeaderBranding {
  logoUrl: string | null
  brandColor: string | null
}

interface StatusHeaderProps {
  projectName: string
  projectUrl: string
  overallStatus: OverallStatus
  lastCheckedAt: Date | null
  uptimePercent: number | null
  /**
   * Components count, rendered as "All systems operational" only when
   * there is at least one component. When zero, the page renders a
   * different empty state.
   */
  componentCount: number
  branding: StatusHeaderBranding
}

function timeAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

/**
 * Tinted version of the status dot when the owner has set a brand colour.
 * Falls back to the default green/red/gray palette otherwise.
 */
function dotColor(status: OverallStatus, brandColor: string | null): string {
  if (brandColor !== null) {
    // Brand-coloured dot — green/red carry the state, the brand hue
    // wins otherwise. Keeps the dot readable on any background.
    if (status === 'ok') return brandColor
    if (status === 'failed') return '#DC2626' // brand hue stays, accent is red
    return '#9CA3AF'
  }
  switch (status) {
    case 'ok':
      return '#10B981' // emerald-500
    case 'failed':
      return '#EF4444' // red-500
    case 'unknown':
      return '#9CA3AF' // gray-400
  }
}

export function StatusHeader({
  projectName,
  projectUrl,
  overallStatus,
  lastCheckedAt,
  uptimePercent,
  componentCount,
  branding,
}: StatusHeaderProps) {
  const isUp = overallStatus === 'ok'
  const isUnknown = overallStatus === 'unknown'
  const accent = dotColor(overallStatus, branding.brandColor)

  return (
    <div
      className="border-b border-gray-100 pb-8"
      data-testid="status-header"
    >
      {/* Project name + URL — with optional logo */}
      <div className="mb-6 flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`h-3 w-3 rounded-full ${isUnknown ? '' : isUp ? '' : 'animate-pulse'}`}
          style={{ backgroundColor: accent }}
        />
        {branding.logoUrl !== null && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logoUrl}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 rounded object-contain"
          />
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-gray-900">{projectName}</h1>
          <p className="truncate text-sm text-gray-400">{projectUrl}</p>
        </div>
      </div>

      {/* Status banner */}
      <div
        className="rounded-lg border px-5 py-4"
        style={
          branding.brandColor !== null
            ? // A subtle 2px tinted border when the owner has branded —
              // keeps the page feeling polished without overpowering the
              // status colour.
              { borderColor: branding.brandColor + '33' } // 20% alpha hex
            : undefined
        }
        data-testid="status-banner"
      >
        <p
          className={`text-lg font-semibold ${
            isUnknown
              ? 'text-gray-500'
              : isUp
                ? 'text-emerald-700'
                : 'text-red-700'
          }`}
        >
          {isUnknown
            ? componentCount === 0
              ? 'No monitors enabled'
              : 'No data yet'
            : isUp
              ? 'All systems operational'
              : 'Service disruption detected'}
        </p>
      </div>

      {/* Uptime stat */}
      {!isUnknown && (
        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm text-gray-500">90-day uptime</span>
          {uptimePercent !== null ? (
            <span
              className={`text-sm font-semibold tabular-nums ${
                uptimePercent >= 99.9
                  ? 'text-emerald-600'
                  : uptimePercent >= 99
                    ? 'text-yellow-600'
                    : 'text-red-600'
              }`}
            >
              {uptimePercent.toFixed(2)}%
            </span>
          ) : (
            <span className="text-sm font-semibold text-gray-400">—</span>
          )}
        </div>
      )}
    </div>
  )
}

export { formatLastUpdated } from './status-polish-helpers'
