/**
 * The hero's scan form as the SERVER renders it — a working form, not a
 * placeholder.
 *
 * It used to draw a disabled button, on the reasoning that the auth-aware
 * version could not exist until React hydrated. That reasoning was about the
 * enhancement, not about the form: submitting a URL does not need JavaScript,
 * and the page whose entire purpose is to collect one should not spend its
 * first second refusing to.
 *
 * So this posts to the same Server Action the hydrated form falls back on. A
 * click that lands before hydration does a full page navigation and starts the
 * scan; a click after it is intercepted by React and stays on the page. Nobody
 * sees a dead button either way.
 *
 * Pixels stay identical to HeroScanForm so the swap at hydration moves nothing.
 * The two differences are invisible: no client-side validation until the real
 * form takes over, and no error text, which arrives instead as ?scan_error on
 * the way back.
 */
import Link from 'next/link'
import { startScanAction } from '@/components/scan/scan-action.ts'
import { ArrowRight, Globe } from './icons.tsx'

const LABEL = 'font-mono text-[11px] uppercase tracking-[0.16em]'

export function HeroScanFormSkeleton() {
  return (
    <form action={startScanAction} noValidate>
      <label htmlFor="hero-url" className={`mb-2.5 block text-hero-ink ${LABEL}`}>
        Paste your website URL
      </label>

      <div className="flex flex-wrap items-stretch border-2 border-hero-ink">
        <span
          aria-hidden="true"
          className="flex w-12 shrink-0 items-center justify-center border-r border-hero-rule text-hero-ink-dim"
        >
          <Globe size={18} />
        </span>

        <input
          id="hero-url"
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
          type="submit"
          className={`flex h-14 w-full shrink-0 items-center justify-center gap-2 border-t-2 border-hero-ink
 bg-hero-ink px-7 font-medium text-hero-on-ink sm:w-auto sm:border-t-0 sm:border-l-2 ${LABEL}`}
        >
          Scan now
          <ArrowRight size={16} />
        </button>
      </div>

      {/* Reserved height, so the hydrated form's error line cannot shift this. */}
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
