/**
 * /robots.txt
 *
 * A product that sells an SEO audit and ships without a robots.txt fails its
 * own check on its own domain, so this file is not optional here the way it is
 * elsewhere.
 *
 * Public pages that are allowed:
 *   - / — landing page
 *   - /pricing — conversion page
 *   - /about — company / product info
 *   - /contact — support contact
 *   - /privacy — privacy policy (required by payment processors)
 *   - /terms — terms of service (required by payment processors)
 *   - /status/<slug> — public status pages, crawlable by design
 *
 * Two kinds of page are deliberately excluded:
 *
 *   - The signed-in app. Every one of these redirects a crawler to /login, so
 *     indexing them spends crawl budget to produce nothing.
 *   - /scan/<id>. These are shareable by link on purpose, and must stay that
 *     way — Disallow controls crawling, not access. But each one is a page
 *     about somebody ELSE's website, and letting search engines index
 *     thousands of them puts other companies' security and SEO problems into
 *     public results under our domain. That is a liability to them and, to us,
 *     a mass of near-duplicate thin pages that drags the domain down.
 */

import type { MetadataRoute } from 'next'
import { serverEnv } from '@/lib/env.ts'

/** Everything a crawler gains nothing from, or should not be republishing. */
const PRIVATE_PATHS = [
  '/api/',
  '/dashboard',
  '/settings/',
  '/projects/',
  '/welcome',
  '/callback',
  '/login',
  '/scan/',
]

export default function robots(): MetadataRoute.Robots {
  const base = serverEnv.appUrl

  return {
    rules: [{ userAgent: '*', allow: '/', disallow: PRIVATE_PATHS }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
