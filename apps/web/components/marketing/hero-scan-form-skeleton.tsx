/**
 * The server-rendered shape of the hero's scan form.
 *
 * Used as a placeholder until the Convex auth context has hydrated on the
 * client, so the landing page's HTML does not depend on the Convex client and
 * the auth-gated behaviour (useConvexAuth) never runs during SSR. Pixels are
 * identical to HeroScanForm: same label, same bordered input + button group,
 * same error reserve, same trailing link. Only the behaviour is missing —
 * nothing is wired to the auth state, because the auth state is not known yet.
 */
import Link from 'next/link'
import { ArrowRight, Globe } from './icons.tsx'

const LABEL = 'font-mono text-[11px] uppercase tracking-[0.16em]'

export function HeroScanFormSkeleton() {
  return (
    <form noValidate>
      <label className={`mb-2.5 block text-hero-ink ${LABEL}`}>Paste your website URL</label>

      <div className="flex flex-wrap items-stretch border-2 border-hero-ink">
        <span
          aria-hidden="true"
          className="flex w-12 shrink-0 items-center justify-center border-r border-hero-rule text-hero-ink-dim"
        >
          <Globe size={18} />
        </span>

        <input
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://your-site.com"
          className="hero-input h-14 min-w-0 flex-1 basis-48 bg-transparent px-4 font-mono text-base text-hero-ink placeholder:text-hero-ink-dim focus-visible:outline-none"
        />

        <button
          type="button"
          disabled
          className={`flex h-14 w-full shrink-0 items-center justify-center gap-2 border-t-2 border-hero-ink
 bg-hero-ink px-7 font-medium text-hero-on-ink sm:w-auto sm:border-t-0 sm:border-l-2 ${LABEL}`}
        >
          Scan now
          <ArrowRight size={16} />
        </button>
      </div>

      <p className={`mt-3 min-h-5 text-hero-ink ${LABEL}`} aria-hidden="true" />

      <Link
        href="/#checks"
        className={`mt-1 inline-flex h-11 items-center border border-hero-ink px-6 text-hero-ink
 transition-colors duration-150 hover:bg-hero-ink hover:text-hero-on-ink ${LABEL}`}
      >
        Read the checks
      </Link>
    </form>
  )
}
