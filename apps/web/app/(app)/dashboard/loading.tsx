import { Skeleton, SkeletonPage } from '@/components/ui/skeleton.tsx'

/**
 * Measured at 1316ms: requireUser, getViewer and the summary aggregate run
 * before a single byte changes on screen.
 *
 * The shape traces the console, not the old list page — the top bar, the scan
 * panel, the summary card beside the monitoring card, then the tiles. Drawing
 * the wrong shape is worse than drawing none, because the layout then jumps
 * when the real page lands.
 *
 * The blocks keep Skeleton's own `bg-line/60`, which reads as the same grey on
 * the console's ground as on the terminal's; only the card chrome around them
 * is restated in `c-` tokens.
 */
export default function DashboardLoading() {
  return (
    <SkeletonPage label="your dashboard" className="console flex min-h-dvh flex-col bg-c-bg text-c-ink">
      <div className="flex h-16 items-center gap-3 border-b border-c-line bg-c-card px-5 sm:px-8">
        <div className="pl-12 lg:pl-0">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="mt-1.5 h-3 w-16 rounded" />
        </div>
        <div className="flex-1" />
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>

      <div className="flex flex-col gap-8 px-5 py-6 sm:px-8 sm:py-8">
        <Panel>
          <Skeleton className="h-4 w-28 rounded" />
          <Skeleton className="mt-3 h-11 w-full max-w-2xl rounded-lg" />
        </Panel>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Panel>
            <Skeleton className="h-2.5 w-full rounded-full" />
            <Skeleton className="mt-5 h-9 w-24 rounded" />
            <Skeleton className="mt-3 h-3 w-2/3 rounded" />
          </Panel>
          <Panel>
            <Skeleton className="mx-auto h-11 w-11 rounded-full" />
            <Skeleton className="mx-auto mt-3 h-3 w-40 rounded" />
          </Panel>
        </div>

        {/* Four tiles, which is what the asset summary always draws. */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <Panel key={tile}>
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="mt-2.5 h-8 w-12 rounded" />
            </Panel>
          ))}
        </div>
      </div>
    </SkeletonPage>
  )
}

/** A card-shaped block, matching the console's own card chrome. */
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-c-line bg-c-card p-5">{children}</div>
}
