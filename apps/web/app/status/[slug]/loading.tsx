import { Skeleton, SkeletonPage, SkeletonRule } from '@/components/ui/skeleton.tsx'

/**
 * A public status page, opened during somebody else's incident by people who
 * have no account and are already anxious. A page that looks broken while it
 * loads is the worst possible answer to "is it down?".
 *
 * The uptime bar is drawn as its real strip of segments rather than one block,
 * so the shape that carries the answer is on screen before the answer is.
 */
export default function StatusLoading() {
  return (
    <SkeletonPage label="this status page" className="mx-auto max-w-2xl px-6 py-16">
      <SkeletonRule />
      <Skeleton className="mt-6 h-8 w-56 max-w-full" />
      <Skeleton className="mt-2 h-3 w-40 max-w-full" />

      <Skeleton className="mt-8 h-6 w-32" />

      <div className="mt-6 flex items-end gap-[3px]">
        {Array.from({ length: 40 }, (_, segment) => (
          <Skeleton key={segment} className="h-10 flex-1" />
        ))}
      </div>
    </SkeletonPage>
  )
}
