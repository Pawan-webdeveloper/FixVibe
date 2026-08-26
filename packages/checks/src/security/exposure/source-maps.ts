/**
 * Source maps published alongside a production bundle.
 *
 * A .map file contains the original, unminified sources — component names,
 * comments, dead code, and often the paths and API shapes the build was meant
 * to obscure. It is not a vulnerability by itself, and plenty of teams publish
 * them deliberately so browser error reports are readable. It is a
 * reconnaissance gift, so it is reported at low and worded as a decision to
 * confirm rather than a hole to close.
 *
 * Two forms, and the check treats them differently because their evidence
 * differs. A `sourceMappingURL` pointing at a file is only reported when that
 * file was actually FETCHED and parses as a source map — a dangling reference
 * to a map that 404s is what a correctly configured build looks like. An
 * inlined `data:` map needs no verification at all: the sources are already in
 * the bundle the browser has.
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'security.exposure.source-maps'

/** Browsers read the last one; the comment sits at the end of the file. */
const SOURCE_MAPPING_URL = /\/\/[#@]\s*sourceMappingURL=(\S+)/g

/** Spending the whole probe budget on maps would starve the rest of the registry. */
const MAX_MAP_PROBES = 3

function looksLikeSourceMap(body: string): boolean {
  return /"version"\s*:\s*3/.test(body) && /"sources"\s*:\s*\[/.test(body)
}

export const sourceMapsCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Source maps',

  async run(ctx) {
    const inlined: string[] = []
    const candidates: Array<{ script: string; map: URL }> = []

    for (const script of ctx.scripts) {
      if (!script.content) continue
      for (const [, reference] of script.content.matchAll(SOURCE_MAPPING_URL)) {
        if (!reference) continue

        if (reference.startsWith('data:')) {
          // The sources are embedded in the file the browser already has.
          inlined.push(script.url || 'inline script')
          continue
        }
        try {
          candidates.push({ script: script.url || 'inline script', map: new URL(reference, script.url || ctx.finalUrl) })
        } catch {
          // A reference we cannot resolve is a reference we cannot check.
        }
      }
    }

    const published: string[] = []
    for (const { map } of candidates.slice(0, MAX_MAP_PROBES)) {
      // probe() is same-origin only, so a map on another host goes unverified —
      // and unverified means unreported.
      if (map.origin !== ctx.finalUrl.origin) continue
      const response = await ctx.probe(`${map.pathname}${map.search}`)
      if (response?.status === 200 && looksLikeSourceMap(response.body)) published.push(map.href)
    }

    if (published.length === 0 && inlined.length === 0) return []

    const detail = [
      ...published.map((url) => `${url} (served)`),
      ...inlined.map((script) => `${script} (map inlined in the bundle)`),
    ]

    return [
      {
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: `Source maps are published for ${detail.length} bundle${detail.length === 1 ? '' : 's'}`,
        description:
          `The original sources behind the minified JavaScript are readable: ${detail.join(', ')}. ` +
          'That gives a reader the unminified code, its comments, and any internal route or API ' +
          'shape the build removed from the output. Often deliberate — teams publish maps so ' +
          'production stack traces stay legible — so this is a decision to confirm rather than a defect.',
        evidence: { published, inlined },
        remediation:
          'If the maps are not meant to be public, stop emitting them or upload them to the error ' +
          'tracker instead of the web root.',
        fixPrompt:
          `This site publishes source maps for: ${detail.join(', ')}.\n\n` +
          'If that is deliberate — some teams want legible production stack traces — no change is ' +
          'needed. If not: turn off source map output for the production build (Next.js: ' +
          '`productionBrowserSourceMaps: false`, which is already the default; Vite: ' +
          '`build.sourcemap: false`), or keep generating them and upload them to Sentry or your error ' +
          'tracker as part of the deploy while excluding *.map from what the web server serves.',
      } satisfies Finding,
    ]
  },
}
