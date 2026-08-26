import Link from 'next/link'
import { allChecks, type Category } from '@darvin/checks'
import { ScanForm } from '@/components/scan/scan-form.tsx'
import { Reveal } from '@/components/marketing/reveal.tsx'

/**
 * The landing page, structured as a product narrative rather than a feature
 * grid: hero → unfair advantage → one act per pillar group → proof table →
 * close. The coverage line counts the live registry rather than a number typed
 * into the markup, so the page cannot advertise checks the engine does not
 * actually run.
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

function checkTitles(): string[] {
  return allChecks.map((check) => check.title).sort((a, b) => a.localeCompare(b))
}

const ADVANTAGES = [
  {
    kicker: 'Evidence, not flags',
    title: 'See every byte of the response',
    body: 'Headers, HTML, cookies, TLS and DNS gathered in one pass. Every finding ships with the evidence that proves it — the raw header, the exact line, the certificate dates.',
  },
  {
    kicker: 'Depth, not checkboxes',
    title: 'Findings generic scanners miss',
    body: 'Stack-aware context means checks tuned to how your site is actually built — catching what a generic ruleset glued together from open-source tools walks straight past.',
  },
  {
    kicker: 'AEO nobody else tests',
    title: 'Built for AI answer engines',
    body: 'Search is no longer the only front door. Darvin scores how well AI answer engines can read, cite and recommend your site — territory commodity scanners have not touched.',
  },
  {
    kicker: 'Fixes you can paste',
    title: 'Every finding ends in a fix',
    body: 'Each finding carries a copy-paste fix prompt your coding agent can apply as-is. A report that stops at “add a header” is only half a report.',
  },
]

const ACTS = [
  {
    eyebrow: 'Scan & Score',
    heading: 'Know everything, in under a minute',
    intro:
      'Paste a URL. Darvin reads the response the way a browser and a crawler would, then runs every registered check over it and scores each pillar out of 100.',
    cards: [
      {
        title: 'One fetch, total context',
        body: 'A scan fetches the page once and builds a full context — response headers, parsed HTML, cookies, the certificate chain, DNS records, robots.txt. Every check is a pure function over that context, so results are reproducible and false positives on an unchanged site stay near zero.',
        link: { href: '/#scan', label: 'Run a scan' },
      },
      {
        title: 'Scores across six pillars',
        body: 'Security, SEO, AEO, performance, accessibility and compliance, each scored 0–100 with severity-ranked findings underneath. The worst problems surface first; the long tail stays one click away.',
        link: { href: '/pricing', label: 'See what a report includes' },
      },
    ],
  },
  {
    eyebrow: 'Evidence & Fixes',
    heading: 'Turn findings into shipped fixes',
    intro:
      'A finding without proof is a guess, and a fix you still have to write is homework. Darvin gives you both: the evidence that makes the finding undeniable, and the prompt that closes it.',
    cards: [
      {
        title: 'Evidence attached to everything',
        body: 'Every finding shows exactly what was observed — the missing header by name, the cookie without its flags, the mixed-content URL, the certificate expiring on a dated line. You can verify any claim against your own site in seconds.',
        link: { href: '/#scan', label: 'Scan your site' },
      },
      {
        title: 'One prompt fixes the whole site',
        body: 'Per-finding fix prompts unblock you immediately, and Pro goes further: a single prompt covering every finding, ready to hand to your coding agent. Paste it, review the diff, ship.',
        link: { href: '/pricing', label: 'Get the full-report prompt' },
      },
    ],
  },
  {
    eyebrow: 'Prove & Monitor',
    heading: 'Catch regressions before your users do',
    intro:
      'A clean scan today says nothing about tomorrow’s deploy. Monitors re-scan your sites on a schedule and track score movement over time, so a fix that silently reverts gets caught.',
    cards: [
      {
        title: 'History and score changes',
        body: 'Every scan is kept. Watch each pillar’s score move release by release, and see precisely which check regressed when a deploy drops your security grade.',
        link: { href: '/pricing', label: 'See monitoring plans' },
      },
      {
        title: 'Monitored sites, checked on schedule',
        body: 'Point a monitor at the sites you own and Darvin re-runs the full suite automatically. New findings arrive with the same evidence and fix prompts as a manual scan.',
        link: { href: '/#scan', label: 'Start monitoring' },
      },
    ],
  },
]

const COMPARISON = [
  { aspect: 'Findings on the free tier', them: 'Severity count only', us: 'The worst findings in full' },
  { aspect: 'Fix prompts', them: 'Not offered', us: 'Per finding — plus one prompt for the whole site' },
  { aspect: 'AEO checks', them: 'Not offered', us: 'Scored as a first-class pillar' },
  { aspect: 'Entry paid tier', them: '$24 / month', us: '$19 / month, every finding in full' },
]

export default function LandingPage() {
  const { total, pillars } = coverage()
  const titles = checkTitles()

  return (
    <div className="theme-dark min-h-dvh bg-canvas text-ink">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-md">
        <nav aria-label="Primary" className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
          <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
            darvin
          </Link>
          <div className="hidden items-center gap-6 text-sm text-muted md:flex">
            <a href="#advantage" className="transition-colors hover:text-ink">Why Darvin</a>
            <a href="#product" className="transition-colors hover:text-ink">Product</a>
            <a href="#proof" className="transition-colors hover:text-ink">Compare</a>
            <Link href="/pricing" className="transition-colors hover:text-ink">Pricing</Link>
          </div>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/login" className="text-muted transition-colors hover:text-ink">Log in</Link>
            <Link
              href="/#scan"
              className="rounded-full bg-accent px-4 py-2 font-medium text-accent-ink transition-opacity hover:opacity-90"
            >
              Run a free scan
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0" />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[480px]"
            style={{
              background:
                'radial-gradient(ellipse 55% 45% at 50% -5%, color-mix(in oklab, var(--accent) 14%, transparent), transparent 70%)',
            }}
          />
          <div className="relative mx-auto max-w-4xl px-6 pb-24 pt-24 text-center sm:pt-32">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
              Read-only · Evidence-backed · No signup
            </p>
            <h1 className="mt-6 text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
              The website auditing platform for teams who ship.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted sm:text-xl">
              Paste a URL. Darvin runs {total}+ checks across security, SEO, AEO, performance,
              accessibility and compliance — each finding backed by evidence and ending in a fix you
              can paste.
            </p>
            <div id="scan" className="mx-auto mt-12 max-w-xl scroll-mt-24 text-left">
              <ScanForm />
            </div>
            <p className="mt-6 font-mono text-sm text-muted">
              {total} checks, no signup: {pillars.join(', ')}.
            </p>
          </div>

          {/* Marquee of live check titles */}
          <Reveal>
            <div
              aria-hidden
              className="overflow-hidden border-y border-line py-4"
            >
              <div
                className="flex w-max gap-10 whitespace-nowrap font-mono text-sm text-muted"
                style={{ animation: 'marquee 90s linear infinite' }}
              >
                {[...titles, ...titles].map((title, index) => (
                  <span key={index} className="flex items-center gap-10">
                    {title}
                    <span className="text-good">✓</span>
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── Unfair advantage ──────────────────────────────────────────── */}
        <section id="advantage" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-28">
          <Reveal>
            <h2 className="max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              Findings your competitors’ scanners cannot produce.
            </h2>
            <p className="mt-5 max-w-2xl text-pretty text-lg text-muted">
              Anyone can glue open-source scanners together and call it a dashboard. Darvin competes
              on depth: real evidence, stack-aware checks, honest AEO scoring — and fixes, not just
              flags.
            </p>
          </Reveal>
          <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
            {ADVANTAGES.map((item, index) => (
              <Reveal key={item.title} delay={index * 80}>
                <article className="flex h-full flex-col gap-3 bg-surface p-8 transition-colors hover:bg-canvas">
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">
                    {item.kicker}
                  </p>
                  <h3 className="text-xl font-semibold tracking-tight">{item.title}</h3>
                  <p className="text-pretty text-muted">{item.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Product acts ─────────────────────────────────────────────── */}
        <div id="product" className="scroll-mt-20">
          {ACTS.map((act, actIndex) => (
            <section key={act.eyebrow} className="border-t border-line">
              <div className="mx-auto max-w-6xl px-6 py-28">
                <Reveal>
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
                    {String(actIndex + 1).padStart(2, '0')} · {act.eyebrow}
                  </p>
                  <h2 className="mt-4 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                    {act.heading}
                  </h2>
                  <p className="mt-5 max-w-2xl text-pretty text-lg text-muted">{act.intro}</p>
                </Reveal>
                <div className="mt-14 grid gap-6 lg:grid-cols-2">
                  {act.cards.map((card, cardIndex) => (
                    <Reveal key={card.title} delay={cardIndex * 100}>
                      <article className="flex h-full flex-col rounded-xl border border-line bg-surface p-8">
                        <h3 className="text-2xl font-semibold tracking-tight">{card.title}</h3>
                        <p className="mt-4 flex-1 text-pretty text-muted">{card.body}</p>
                        <Link
                          href={card.link.href}
                          className="mt-8 inline-flex w-fit items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-medium transition-colors hover:border-ink"
                        >
                          {card.link.label} <span aria-hidden>→</span>
                        </Link>
                      </article>
                    </Reveal>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* ── Proof table ──────────────────────────────────────────────── */}
        <section id="proof" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto max-w-5xl px-6 py-28">
            <Reveal>
              <h2 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                Know the difference before you pay anyone.
              </h2>
              <p className="mt-5 max-w-2xl text-pretty text-lg text-muted">
                Full findings cost money elsewhere. Here the worst of them are free — and the paid
                tier costs less while including more.
              </p>
            </Reveal>
            <Reveal delay={120}>
              <div className="mt-14 overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface">
                      <th scope="col" className="p-5 font-medium text-muted">What matters</th>
                      <th scope="col" className="p-5 font-medium text-muted">The scanner you know</th>
                      <th scope="col" className="p-5 font-medium text-ink">Darvin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON.map((row) => (
                      <tr key={row.aspect} className="border-b border-line last:border-b-0">
                        <th scope="row" className="p-5 font-normal text-muted">{row.aspect}</th>
                        <td className="p-5 text-muted">{row.them}</td>
                        <td className="p-5 font-medium text-ink">{row.us}</td>
                      </tr>
                    ))}
                    <tr className="bg-surface">
                      <th scope="row" className="p-5 font-normal text-muted">Price to start</th>
                      <td className="p-5 text-muted">$0 — but counts, not findings</td>
                      <td className="p-5 font-medium text-ink">$0 — the worst findings in full, all {total} checks</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Close ────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-t border-line">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 50% 60% at 50% 110%, color-mix(in oklab, var(--accent) 12%, transparent), transparent 70%)',
            }}
          />
          <div className="relative mx-auto max-w-3xl px-6 py-28 text-center">
            <Reveal>
              <h2 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                Own the truth about your site.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-pretty text-lg text-muted">
                Run your first scan free. No signup, no credit card — just paste a URL.
              </p>
              <div className="mx-auto mt-10 max-w-xl text-left">
                <ScanForm />
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 text-sm sm:grid-cols-3">
          <div>
            <p className="font-mono font-semibold tracking-tight">darvin</p>
            <p className="mt-3 max-w-xs text-pretty text-muted">
              Darvin reads only what a browser would read. It never logs in, submits forms, or
              attempts anything a site owner has not already made public.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-2 text-muted">
            <Link href="/" className="w-fit transition-colors hover:text-ink">Home</Link>
            <Link href="/pricing" className="w-fit transition-colors hover:text-ink">Pricing</Link>
            <Link href="/status" className="w-fit transition-colors hover:text-ink">Status</Link>
          </nav>
          <p className="text-muted sm:text-right">© Darvin {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  )
}
