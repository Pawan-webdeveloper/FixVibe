import { Skeleton, SkeletonPage, SkeletonRule } from '@/components/ui/skeleton.tsx'

/**
 * The one question asked after a first sign-in.
 *
 * Reached by redirect from /callback rather than by a click, so the person
 * arrives here mid-flight and has no idea a page is coming. Drawing its shape
 * is what stops the sign-in feeling like it stalled.
 */
export default function WelcomeLoading() {
  return (
    <SkeletonPage label="one question" className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
      <SkeletonRule />
      <Skeleton className="mt-6 h-9 w-80 max-w-full" />
      <Skeleton className="mt-5 h-4 w-full max-w-[64ch]" />
      <Skeleton className="mt-2 h-4 w-4/5 max-w-[64ch]" />

      {/* The pillar checkboxes. Six, because there are six pillars. */}
      <div className="mt-10 flex flex-col gap-3">
        {[0, 1, 2, 3, 4, 5].map((option) => (
          <div key={option} className="flex items-center gap-3 border border-line px-5 py-4">
            <Skeleton className="h-4 w-4 shrink-0" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>

      <Skeleton className="mt-8 h-11 w-32" />
    </SkeletonPage>
  )
}
