/**
 * apps/web/app/(app)/onboarding/loading.tsx
 *
 * Skeleton for the wizard while the page is hydrating.
 *
 * The server shell resolves a couple of small reads (project count,
 * email_verified) and then mounts the client component. There is no
 * reason for that to feel like a blank page — a labelled rule and
 * three soft blocks communicate "this is the wizard" before the
 * client state machine takes over.
 */

export default function OnboardingLoading() {
  return (
    <div className="console flex min-h-dvh flex-col bg-c-bg text-c-ink">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10 sm:px-10 sm:py-14">
        <div className="h-3 w-40 rounded bg-c-soft" />
        <div className="h-8 w-72 rounded bg-c-soft" />
        <div className="mt-6 h-32 rounded-xl border border-c-line/60 bg-c-card" />
        <div className="h-12 rounded-full bg-c-soft" />
      </div>
    </div>
  )
}
