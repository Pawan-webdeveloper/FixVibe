import { Skeleton } from '@/components/ui/skeleton.tsx'

/**
 * Covers billing and API keys both.
 *
 * Deliberately draws only the panel: this segment's layout owns the heading and
 * the tab strip, and a loading state renders INSIDE its layout. Repeating them
 * here would paint a second header over the real one for the length of the
 * fetch.
 */
export default function SettingsLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="mt-8">
      <span className="sr-only">Loading your settings</span>

      <div className="border border-line p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-4 w-full max-w-md" />
        <Skeleton className="mt-2 h-4 w-3/4 max-w-sm" />
        <Skeleton className="mt-6 h-11 w-36" />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {[0, 1].map((row) => (
          <div key={row} className="flex items-center gap-4 border border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-48 max-w-full" />
            </div>
            <Skeleton className="h-8 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
