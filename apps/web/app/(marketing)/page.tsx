import { allChecks, type Category } from '@darvin/checks'
import { ScanForm } from '@/components/scan/scan-form.tsx'

/**
 * The landing page has one job: get a URL into the box.
 *
 * The coverage line below counts the live registry rather than a number typed
 * into the markup, so the page cannot advertise checks the engine does not
 * actually run. It is also the cheapest proof that the app and the engine are
 * wired together at all.
 */

const PILLAR_LABEL: Partial<Record<Category, string>> = {
  security: 'security',
  seo: 'SEO',
  performance: 'performance',
  accessibility: 'accessibility',
  aeo: 'AI answer engines',
  compliance: 'compliance',
}

function coverage(): { total: number; pillars: string[] } {
  const counts = new Map<Category, number>()
  for (const check of allChecks) {
    counts.set(check.category, (counts.get(check.category) ?? 0) + 1)
  }

  const pillars = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${count} ${PILLAR_LABEL[category] ?? category}`)

  return { total: allChecks.length, pillars }
}

export default function LandingPage() {
  const { total, pillars } = coverage()

  return (
    <div className="mx-auto max-w-2xl px-6 py-20 sm:py-28">
      <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Find what your website is quietly getting wrong.
      </h1>

      <p className="mt-5 text-lg text-muted text-pretty">
        Paste a URL. Darvin reads the response the way a browser and a crawler would, and reports
        what it can actually prove — with the exact fix for each finding.
      </p>

      <div className="mt-10">
        <ScanForm />
      </div>

      <p className="mt-6 text-sm text-muted">
        {total} checks, no signup: {pillars.join(', ')}.
      </p>
    </div>
  )
}
