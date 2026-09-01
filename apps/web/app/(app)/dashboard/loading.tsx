import { Skeleton, SkeletonPage } from '@/components/ui/skeleton.tsx'

export default function DashboardLoading() {
  return (
    <SkeletonPage label="your dashboard" className="console flex min-h-dvh flex-col bg-c-bg text-c-ink">
      <div className="flex h-16 items-center gap-3 border-b border-c-line/60 bg-c-bg/80 px-6 sm:px-10">
        <div className="pl-12 lg:pl-0">
          <Skeleton className="h-4 w-24 rounded" />
        </div>
        <div className="flex-1" />
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>

      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-12 px-6 py-10 sm:px-10 sm:py-14">
        <div className="overflow-hidden rounded-2xl border border-c-line/60 bg-c-card p-8 sm:p-10">
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="mt-4 h-8 w-48 rounded" />
          <Skeleton className="mt-2 h-4 w-80 rounded" />
          <Skeleton className="mt-8 h-12 w-full max-w-2xl rounded-xl" />
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-c-line/60 bg-c-card p-8">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="mt-6 h-3 w-full rounded-full" />
            <Skeleton className="mt-8 h-10 w-24 rounded" />
            <Skeleton className="mt-3 h-4 w-48 rounded" />
          </div>
          <div className="rounded-xl border border-c-line/60 bg-c-card p-8">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="mx-auto mt-6 h-12 w-12 rounded-full" />
            <Skeleton className="mx-auto mt-4 h-4 w-48 rounded" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <div key={tile} className="rounded-xl border border-c-line/60 bg-c-card p-6">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="mt-4 h-8 w-12 rounded" />
              <Skeleton className="mt-2 h-3 w-24 rounded" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  )
}
