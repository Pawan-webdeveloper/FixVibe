import Link from 'next/link'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'

export const metadata = { title: 'Not found' }

/**
 * 404 inside the auth route group. Minimal shell — the auth pages are bare
 * by design, and a not-found here should match that.
 */
export default function AuthNotFound() {
  return (
    <div className="mx-auto max-w-sm px-6 py-24">
      <LabeledRule label="404" trailing="no such page" />
      <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">
        There is nothing at this address
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-muted text-pretty">
        The link may be mistyped, or the page may have been removed.
      </p>

      <Link
        href="/login"
        className="label mt-8 inline-flex h-11 items-center border border-ink bg-ink px-6 text-canvas
                   transition-colors hover:bg-transparent hover:text-ink"
      >
        Sign in
      </Link>
    </div>
  )
}
