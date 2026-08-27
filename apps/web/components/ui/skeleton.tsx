/**
 * The shapes a page wears while its data is still being fetched.
 *
 * Every signed-in screen here is server-rendered against Postgres, which means
 * a navigation costs a round trip before anything changes on screen — measured
 * at 1.0s to 1.3s for the report, a project and the dashboard. Without a
 * loading state the browser holds the OLD page for that whole second: the click
 * appears to have done nothing, and people click again.
 *
 * A skeleton rather than a spinner, because these pages have a known shape.
 * Drawing that shape says which page is arriving and reserves the space it will
 * occupy, so the real content does not shove the layout around when it lands. A
 * spinner says only "wait", and centred spinners make every page look alike
 * during the one moment the person is trying to tell them apart.
 */

/**
 * One grey block.
 *
 * `aria-hidden` throughout: the blocks are decoration, and a screen reader
 * announcing a dozen empty boxes is worse than silence. The announcement is
 * made once, by the wrapper.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`bg-line/60 motion-reduce:animate-none animate-pulse ${className}`}
    />
  )
}

/** A line of body text. Widths vary because real text does. */
export function SkeletonText({ className = '' }: { className?: string }) {
  return <Skeleton className={`h-4 ${className}`} />
}

/**
 * The `[ LABEL ]────────── trailing` device every screen is headed by.
 *
 * Matched to LabeledRule's own markup so the header does not jump when the
 * page resolves — the rule is the one element present on every screen, and it
 * is what makes the skeleton read as this product rather than a generic
 * loading page.
 */
export function SkeletonRule({ trailing = true }: { trailing?: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <Skeleton className="h-3 w-24 shrink-0" />
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      {trailing && <Skeleton className="h-3 w-16 shrink-0" />}
    </div>
  )
}

/**
 * The wrapper every loading.tsx uses.
 *
 * `role="status"` with `aria-live="polite"` announces the wait once, and
 * `aria-busy` marks the region as not yet settled. `label` names the screen
 * being loaded, because "Loading" alone tells somebody who cannot see the
 * skeleton nothing about where they are going.
 */
export function SkeletonPage({
  label,
  className = 'mx-auto max-w-5xl px-6 py-10',
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">Loading {label}</span>
      {children}
    </div>
  )
}
