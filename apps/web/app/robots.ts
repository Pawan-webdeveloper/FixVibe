/**
 * /robots.txt
 *
 * A product that sells an SEO audit and ships without a robots.txt fails its
 * own check on its own domain, so this file is not optional here the way it is
 * elsewhere.
 *
 * The interesting decision is what to keep OUT. Two kinds of page are
 * deliberately excluded:
 *
 *   - The signed-in app. Every one of these redirects a crawler to /login, so
 *     indexing them spends crawl budget to produce nothing.
 *   - /scan/<id>. These are shareable by link on purpose, and must stay that
 *     way — Disallow controls crawling, not access. But each one is a page
 *     about somebody ELSE's website, and letting search engines index
 *     thousands of them puts other companies' security and SEO problems into
 *     public results under our domain. That is a liability to them and, to us,
 *     a mass of near-duplicate thin pages that drags the domain down.
 *
 * /status/<slug> is deliberately left crawlable. It is public by design and is
 * the one page in the product that appears in front of somebody else's users.
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
