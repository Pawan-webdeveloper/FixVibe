import Link from 'next/link'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'

export const metadata = { title: 'Not found' }

/**
 * 404 inside the signed-in console. No logo header — the sidebar already
 * provides navigation. The message is short because a user who hits a bad
 * path while signed in is already oriented.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24">
      <LabeledRule label="404" trailing="no such page" />
      <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
        There is nothing at this address
      </h1>
      <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-muted text-pretty">
        The link may be mistyped, or the page may have been moved.
      </p>

      <Link
        href="/dashboard"
        className="label mt-8 inline-flex h-11 items-center border border-ink bg-ink px-6 text-canvas
                   transition-colors hover:bg-transparent hover:text-ink"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
