import type { Metadata, Viewport } from 'next'
import { Geist_Mono } from 'next/font/google'
import './globals.css'

/**
 * Self-hosted at build time by next/font, so the page makes no request to a
 * third party for its own typeface. That matters more here than elsewhere:
 * this product's own compliance pillar flags trackers that load before
 * consent, and a landing page phoning Google for a font would fail its own
 * check.
 *
 * One family, because the product has one voice. A sans companion was loaded
 * here until every surface became monospace; nothing referenced it afterwards,
 * and an unused webfont is a download on every page for nothing.
 */
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' })

export const metadata: Metadata = {
  metadataBase: new URL(process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'),
  title: {
    default: 'Darvin — everything wrong with your website, and the prompt that fixes it',
    template: '%s · Darvin',
  },
  description:
    'Paste a URL and get 63 read-only checks across security, SEO, AI answer engines, performance, ' +
    'accessibility and compliance — each with the evidence observed and a fix prompt for your AI ' +
    'coding agent. Scanning is free.',
  openGraph: {
    type: 'website',
    siteName: 'Darvin',
    title: 'Everything wrong with your website — and the prompt that fixes it',
    description:
      '63 read-only checks across security, SEO, AI answer engines, performance, accessibility and ' +
      'compliance. Every finding shows the evidence behind it.',
  },
  twitter: { card: 'summary_large_image' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

/**
 * Deliberately reads nothing per-request — no cookies, no session, no identity.
 *
 * Convex Auth's server provider belongs BELOW this, in the (auth) and (app)
 * layouts, because it calls `cookies()` and anything under a component that
 * does is rendered dynamically. Mounted here it turned the landing page and
 * the pricing page — the two a stranger sees first, both statically
 * prerendered — into a server render on every view, to read a cookie neither
 * of them consults.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mono.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
