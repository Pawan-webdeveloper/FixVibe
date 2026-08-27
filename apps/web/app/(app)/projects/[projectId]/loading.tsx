import { Skeleton, SkeletonPage } from '@/components/ui/skeleton.tsx'

/**
 * Measured at 1227ms: getProject then listScansForProject, both after the
 * viewer is resolved.
 *
 * Covers the monitors and verify screens too — a loading state applies to its
 * whole segment, and all three open from the same click with the same header
 * above them.
 */
export default function ProjectLoading() {
  return (
    <SkeletonPage label="this project" className="mx-auto max-w-3xl px-6 py-10">
      <header className="border-b border-line pb-5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-2 h-8 w-64 max-w-full" />
        <Skeleton className="mt-2 h-3 w-48 max-w-full" />
        <Skeleton className="mt-3 h-3 w-32" />
      </header>

      {/* The scan history: date on the left, score on the right. */}
      <ul className="mt-8 flex flex-col gap-3">
        {[0, 1, 2, 3].map((row) => (
          <li key={row} className="flex items-center gap-4 border border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
            <Skeleton className="h-7 w-10 shrink-0" />
          </li>
        ))}
      </ul>
    </SkeletonPage>
  )
}
