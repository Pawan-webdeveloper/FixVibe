/**
 * One prompt that fixes the whole site.
 *
 * Every finding already carries its own `fixPrompt`, which is enough to fix one
 * thing. This turns a report into a single instruction an agent can work
 * through — and the value is not in concatenating them. It is in the two things
 * a per-finding prompt cannot know:
 *
 *   WHERE. "Add a Content-Security-Policy header" is not actionable until you
 *   know whether that means next.config.ts, a _headers file, an nginx block or
 *   a Cloudflare rule. Fourteen findings that all land in the same file should
 *   be one edit, not fourteen.
 *
 *   ORDER. A leaked credential must be rotated before anything else, because
 *   every later change is wasted if the key is already in someone's hands. And
 *   DNS records are not code — an agent told to "fix SPF" will otherwise
 *   cheerfully edit a file and report success.
 *
 * Detection returns null rather than guessing. A confidently wrong framework
 * produces confidently wrong instructions, which is worse than generic ones.
 */

import type { CheckContext, Severity } from './types.ts'
import { SEVERITY_ORDER } from './types.ts'

/* -------------------------------------------------------------------------- */
/* Stack detection                                                            */
/* -------------------------------------------------------------------------- */

export interface StackHint {
  /** 'nextjs', 'nuxt', 'wordpress', … or null when the signals disagree or are absent. */
  framework: string | null
  /** Where it is served from — this decides where response headers are configured. */
  platform: string | null
}

interface Signal {
  name: string
  /** Any one match is enough; these are chosen to be unambiguous on their own. */
  matches: (ctx: CheckContext, html: string, scriptUrls: string) => boolean
}

const FRAMEWORKS: readonly Signal[] = [
  {
    name: 'nextjs',
    matches: (ctx, html, scripts) =>
      /__NEXT_DATA__|\/_next\//.test(html) ||
      scripts.includes('/_next/') ||
      /next\.js/i.test(ctx.headers.get('x-powered-by') ?? ''),
  },
  { name: 'nuxt', matches: (_c, html, scripts) => /__NUXT__|\/_nuxt\//.test(html) || scripts.includes('/_nuxt/') },
  { name: 'sveltekit', matches: (_c, html) => /__sveltekit|\/_app\/immutable\//.test(html) },
  { name: 'astro', matches: (_c, html, scripts) => /astro-island|\/_astro\//.test(html) || scripts.includes('/_astro/') },
  { name: 'remix', matches: (_c, html) => /__remixContext|__remixRouteModules/.test(html) },
  { name: 'gatsby', matches: (_c, html) => /___gatsby|\/page-data\//.test(html) },
  {
    name: 'wordpress',
    matches: (ctx, html) =>
      /\/wp-content\/|\/wp-includes\//.test(html) ||
      /wordpress/i.test(ctx.$('meta[name="generator"]').attr('content') ?? ''),
  },
  { name: 'shopify', matches: (_c, html) => /cdn\.shopify\.com|Shopify\.theme/.test(html) },
  { name: 'laravel', matches: (ctx) => ctx.cookies.some((c) => /^(laravel_session|XSRF-TOKEN)$/i.test(c.name)) },
  { name: 'rails', matches: (ctx, html) => Boolean(ctx.headers.get('x-runtime')) || /csrf-param/.test(html) },
  { name: 'django', matches: (ctx, html) => ctx.cookies.some((c) => c.name === 'csrftoken') || /csrfmiddlewaretoken/.test(html) },
]

const PLATFORMS: readonly Signal[] = [
  { name: 'vercel', matches: (ctx) => Boolean(ctx.headers.get('x-vercel-id') ?? ctx.headers.get('x-vercel-cache')) },
  { name: 'netlify', matches: (ctx) => Boolean(ctx.headers.get('x-nf-request-id')) },
  { name: 'cloudflare', matches: (ctx) => Boolean(ctx.headers.get('cf-ray')) },
  { name: 'nginx', matches: (ctx) => /^nginx/i.test(ctx.headers.get('server') ?? '') },
  { name: 'apache', matches: (ctx) => /^apache/i.test(ctx.headers.get('server') ?? '') },
  { name: 'cloudfront', matches: (ctx) => Boolean(ctx.headers.get('x-amz-cf-id')) },
]

function detect(signals: readonly Signal[], ctx: CheckContext): string | null {
  const html = ctx.html
  const scriptUrls = ctx.scripts.map((s) => s.url).join(' ')
  // First match wins, and the list is ordered most-specific first. A second
  // match is not a tie-break: these signals are chosen so that one is decisive.
  return signals.find((signal) => signal.matches(ctx, html, scriptUrls))?.name ?? null
}

export function detectStack(ctx: CheckContext): StackHint {
  return { framework: detect(FRAMEWORKS, ctx), platform: detect(PLATFORMS, ctx) }
}

/* -------------------------------------------------------------------------- */
/* Where each kind of fix actually happens                                    */
/* -------------------------------------------------------------------------- */

/**
 * Response headers are configured in exactly one place per stack, and getting
 * that place wrong is the difference between a prompt that works and one that
 * sends an agent editing the wrong file. Platform beats framework here: a
 * Next.js app behind Cloudflare can have its headers set in either, but the
 * edge is where they take effect for every response including static assets.
 */
function headerLocation(stack: StackHint): string {
  switch (stack.platform) {
    case 'netlify':
      return 'the `_headers` file in the publish directory, or a `[[headers]]` block in netlify.toml'
    case 'cloudflare':
      return 'a Cloudflare Transform Rule (Rules → Transform Rules → Modify Response Header), or `_headers` if this is Cloudflare Pages'
    case 'nginx':
      return 'the nginx server block, using `add_header … always;` so the header survives error responses too'
    case 'apache':
      return 'the Apache config or .htaccess, using `Header always set`'
    default:
      break
  }
  switch (stack.framework) {
    case 'nextjs':
      return 'the `headers()` function in next.config.ts, applied to the `/(.*)` source so it covers every route'
    case 'nuxt':
      return '`routeRules` in nuxt.config.ts'
    case 'sveltekit':
      return 'the `handle` hook in src/hooks.server.ts'
    case 'astro':
      return 'the adapter config, or the host\'s header configuration'
    case 'wordpress':
      return 'the web server config — not a plugin, so the headers apply to static files as well'
    default:
      return 'wherever response headers are set for this site: the web server config, the CDN, or the framework\'s header configuration'
  }
}

function layoutLocation(stack: StackHint): string {
  switch (stack.framework) {
    case 'nextjs':
      return 'the root layout (app/layout.tsx) via the `metadata` export, so every page inherits it'
    case 'nuxt':
      return '`app.vue` or `useHead()` in the layout'
    case 'sveltekit':
      return 'src/app.html and the root +layout.svelte'
    case 'astro':
      return 'the shared layout component in src/layouts/'
    case 'wordpress':
      return 'the theme\'s header.php, or an SEO plugin if one is already in use'
    case 'shopify':
      return 'the theme.liquid layout'
    default:
      return 'the shared page template or base layout, so every page gets it rather than one'
  }
}

function webRootLocation(stack: StackHint): string {
  switch (stack.framework) {
    case 'nextjs':
      return 'the `public/` directory, or a route handler in app/ for generated files'
    case 'nuxt':
    case 'astro':
    case 'sveltekit':
      return 'the `static/` or `public/` directory'
    case 'wordpress':
      return 'the WordPress root directory'
    default:
      return 'the directory the web server serves as the site root'
  }
}

/* -------------------------------------------------------------------------- */
/* Grouping                                                                   */
/* -------------------------------------------------------------------------- */

type SurfaceId = 'urgent' | 'headers' | 'head' | 'markup' | 'dns' | 'webroot' | 'server' | 'code'

/** Which surface a finding is fixed on, keyed by check id prefix. */
const SURFACE_BY_PREFIX: ReadonlyArray<{ prefix: string; surface: SurfaceId }> = [
  { prefix: 'security.exposure.sensitive-paths', surface: 'urgent' },
  { prefix: 'security.secrets.', surface: 'urgent' },
  { prefix: 'security.backend.', surface: 'urgent' },

  { prefix: 'security.headers.', surface: 'headers' },
  { prefix: 'security.cors.', surface: 'headers' },
  { prefix: 'security.info-leak.', surface: 'headers' },
  { prefix: 'security.cookies.', surface: 'headers' },
  { prefix: 'security.tls.https-redirect', surface: 'headers' },
  { prefix: 'performance.compression', surface: 'headers' },
  { prefix: 'performance.caching-headers', surface: 'headers' },

  { prefix: 'seo.title', surface: 'head' },
  { prefix: 'seo.meta-description', surface: 'head' },
  { prefix: 'seo.canonical', surface: 'head' },
  { prefix: 'seo.open-graph', surface: 'head' },
  { prefix: 'seo.twitter-card', surface: 'head' },
  { prefix: 'seo.viewport', surface: 'head' },
  { prefix: 'seo.lang', surface: 'head' },
  { prefix: 'seo.robots-meta', surface: 'head' },
  { prefix: 'seo.favicon', surface: 'head' },
  { prefix: 'seo.structured-data', surface: 'head' },
  { prefix: 'seo.duplicate-metadata', surface: 'head' },
  { prefix: 'seo.hreflang', surface: 'head' },
  { prefix: 'aeo.entity-schema', surface: 'head' },
  { prefix: 'aeo.faq-howto-schema', surface: 'head' },
  { prefix: 'aeo.author-date', surface: 'head' },

  { prefix: 'security.email.', surface: 'dns' },
  { prefix: 'security.domain.', surface: 'dns' },

  { prefix: 'seo.robots-txt', surface: 'webroot' },
  { prefix: 'seo.sitemap', surface: 'webroot' },
  { prefix: 'security.security-txt', surface: 'webroot' },
  { prefix: 'aeo.llms-txt', surface: 'webroot' },
  { prefix: 'aeo.ai-bots-allowed', surface: 'webroot' },

  { prefix: 'security.exposure.', surface: 'server' },

  { prefix: 'aeo.ssr-content', surface: 'code' },
  { prefix: 'performance.core-web-vitals', surface: 'code' },
  { prefix: 'accessibility.axe', surface: 'markup' },
  { prefix: 'compliance.trackers-before-consent', surface: 'code' },
  { prefix: 'compliance.cookie-banner', surface: 'code' },
]

/** Everything else is a change to what the page renders. */
const DEFAULT_SURFACE: SurfaceId = 'markup'

function surfaceOf(checkId: string): SurfaceId {
  return SURFACE_BY_PREFIX.find((entry) => checkId.startsWith(entry.prefix))?.surface ?? DEFAULT_SURFACE
}

const SURFACE_ORDER: readonly SurfaceId[] = ['urgent', 'headers', 'dns', 'head', 'markup', 'webroot', 'server', 'code']

function heading(surface: SurfaceId, stack: StackHint): { title: string; where: string } {
  switch (surface) {
    case 'urgent':
      return { title: 'Rotate exposed credentials — do this first', where: '' }
    case 'headers':
      return { title: 'Response headers', where: `Set all of these in ${headerLocation(stack)}.` }
    case 'dns':
      return {
        title: 'DNS records — NOT code',
        // Stated as forcefully as this because an agent handed "fix SPF" will
        // otherwise edit a file, commit it, and report the problem solved.
        where:
          'These are changed at the DNS provider for the domain. Do NOT edit any file in the ' +
          'repository for them. If DNS is managed as code here (a zone file, Terraform, Pulumi, CDK), ' +
          'change it there; otherwise output the exact records to add and stop.',
      }
    case 'head':
      return { title: 'Markup in <head>', where: `Add these in ${layoutLocation(stack)}.` }
    case 'markup':
      return { title: 'Page markup', where: 'These are edits to the components or templates that render the page.' }
    case 'webroot':
      return { title: 'Files at the web root', where: `These live in ${webRootLocation(stack)}.` }
    case 'server':
      return { title: 'Web server and build configuration', where: '' }
    case 'code':
      return { title: 'Application code', where: '' }
  }
}

/* -------------------------------------------------------------------------- */
/* The prompt                                                                 */
/* -------------------------------------------------------------------------- */

const STACK_LABEL: Record<string, string> = {
  nextjs: 'Next.js',
  nuxt: 'Nuxt',
  sveltekit: 'SvelteKit',
  astro: 'Astro',
  remix: 'Remix',
  gatsby: 'Gatsby',
  wordpress: 'WordPress',
  shopify: 'Shopify',
  laravel: 'Laravel',
  rails: 'Ruby on Rails',
  django: 'Django',
  vercel: 'Vercel',
  netlify: 'Netlify',
  cloudflare: 'Cloudflare',
  nginx: 'nginx',
  apache: 'Apache',
  cloudfront: 'CloudFront',
}

const label = (key: string | null): string | null => (key ? (STACK_LABEL[key] ?? key) : null)

function describeStack(stack: StackHint): string {
  const framework = label(stack.framework)
  const platform = label(stack.platform)
  if (framework && platform) return `It is a ${framework} site served through ${platform}.`
  if (framework) return `It is a ${framework} site.`
  if (platform) return `It is served through ${platform}.`
  // Honest about not knowing, and it changes what the agent should do first.
  return 'The stack could not be identified from the response, so confirm where response headers and page templates live before editing.'
}

const rank = (severity: Severity) => SEVERITY_ORDER.indexOf(severity)

/**
 * The parts of a finding this needs, and no more.
 *
 * Structural rather than `Finding` on purpose: a row read back from the
 * database types `evidence` as `| null` where the engine types it `| undefined`,
 * and Phase 4's redacted PublicFinding drops fields entirely. Asking for the
 * four fields actually used means every one of those satisfies it without a
 * cast — and a cast here would be a cast around a type mismatch that is real.
 */
export interface FixableFinding {
  checkId: string
  severity: Severity
  title: string
  fixPrompt: string
}

export interface FixPromptContext {
  /** The URL that was scanned, as landed on. */
  url: string
  stack: StackHint
}

/**
 * Returns an empty string when there is nothing to fix — callers should treat
 * that as "no prompt", not as a prompt saying nothing.
 */
export function buildFixPrompt(findings: readonly FixableFinding[], context: FixPromptContext): string {
  // Informational rows describe rather than ask; putting them in a work order
  // pads it with items an agent cannot act on.
  const actionable = findings.filter((finding) => finding.severity !== 'info')
  if (actionable.length === 0) return ''

  const host = (() => {
    try {
      return new URL(context.url).hostname
    } catch {
      return context.url
    }
  })()

  const grouped = new Map<SurfaceId, FixableFinding[]>()
  for (const finding of actionable) {
    const surface = surfaceOf(finding.checkId)
    grouped.set(surface, [...(grouped.get(surface) ?? []), finding])
  }

  const lines: string[] = [
    `Fix the issues below on ${host}. ${describeStack(context.stack)}`,
    '',
    `${actionable.length} issues, grouped by where the change is made. Work through the sections in ` +
      'order; within a section every change lands in the same place, so make them as one edit.',
  ]

  let section = 0
  for (const surface of SURFACE_ORDER) {
    const items = grouped.get(surface)
    if (!items || items.length === 0) continue

    section += 1
    const { title, where } = heading(surface, context.stack)
    lines.push('', `## ${section}. ${title}`)
    if (where) lines.push('', where)
    lines.push('')

    for (const finding of [...items].sort((a, b) => rank(a.severity) - rank(b.severity))) {
      lines.push(`### ${finding.title}  [${finding.severity}]`)
      lines.push(finding.fixPrompt.trim())
      lines.push('')
    }
  }

  lines.push(
    '---',
    '',
    'When you are done, re-scan the site rather than assuming. Several of these are only ' +
      'observable from outside — a header set in the wrong layer, or a file the build did not copy, ' +
      'looks correct in the repository and unchanged over HTTP.',
  )

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
