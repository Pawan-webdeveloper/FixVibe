import { Skeleton, SkeletonPage, SkeletonRule } from '@/components/ui/skeleton.tsx'

/**
 * Measured at 1316ms: requireUser, getViewer and listProjectSummaries in
 * sequence before a single byte changes on screen.
 *
 * Three rows are drawn rather than the real count, which is not known yet.
 * Three is enough to read as a list and short enough that a person with one
 * project does not watch two of them disappear.
 */
export default function DashboardLoading() {
  return (
    <SkeletonPage label="your projects">
      <SkeletonRule />

      {/* Where NewProjectForm sits. */}
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <Skeleton className="h-11 flex-1 basis-64" />
        <Skeleton className="h-11 w-28" />
      </div>

      <ul className="mt-8 flex flex-col gap-3">
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex items-center gap-4 border border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-2 h-3 w-56 max-w-full" />
            </div>
            {/* The score, which is the thing the eye goes to on this page. */}
            <div className="flex flex-col items-end gap-2">
              <Skeleton className="h-7 w-10" />
              <Skeleton className="h-3 w-16" />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonPage>
  )
}
