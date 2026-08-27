import { Skeleton, SkeletonPage, SkeletonRule } from '@/components/ui/skeleton.tsx'

/**
 * Measured at 999ms, and the page most likely to be opened from a link rather
 * than from inside the app — a report pasted into somebody's Slack channel,
 * clicked by a person who has never seen this product. A blank second is a
 * worse first impression here than anywhere else in the app.
 *
 * The score ring and the six pillar rows are drawn at their real sizes so the
 * report does not jump when the numbers arrive.
 */
export default function ScanLoading() {
  return (
    <SkeletonPage label="this report" className="mx-auto max-w-3xl px-6 py-10">
      <SkeletonRule />
      <Skeleton className="mt-5 h-9 w-72 max-w-full" />

      <div className="mt-8 flex flex-wrap items-center gap-8">
        {/* ScoreRing is a circle, so this one is round. */}
        <Skeleton className="h-32 w-32 shrink-0 rounded-full" />

        <div className="min-w-0 flex-1 basis-64 flex flex-col gap-3">
          {[0, 1, 2, 3, 4, 5].map((pillar) => (
            <div key={pillar} className="flex items-center gap-3">
              <Skeleton className="h-3 w-28 shrink-0" />
              <Skeleton className="h-2 flex-1" />
              <Skeleton className="h-3 w-8 shrink-0" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-12">
        <SkeletonRule />
        <div className="mt-6 flex flex-col gap-4">
          {[0, 1, 2, 3].map((finding) => (
            <div key={finding} className="border border-line p-5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-5 w-3/4" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-5/6" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  )
}
