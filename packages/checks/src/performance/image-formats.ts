/**
 * Images served only in JPEG or PNG.
 *
 * WebP and AVIF are 25–50% smaller at the same visual quality and are supported
 * by every browser in use. On an image-heavy page that difference is most of
 * the page weight.
 *
 * Advisory, and scoped so it does not nag. A page with one PNG logo is fine;
 * the finding is for a page carrying several legacy images with no modern
 * format offered anywhere. An <img> inside a <picture> with a modern <source>,
 * or one whose srcset offers webp/avif, is already doing the right thing and is
 * not counted.
 */

import type { Check, CheckContext, Finding } from '../types.ts'

const ID = 'performance.image-formats'

const LEGACY = /\.(jpe?g|png)(?:$|\?)/i
const MODERN = /\.(webp|avif)(?:$|\?|\s)/i

/** Enough images that format choice is a page-weight decision, not a detail. */
const MIN_LEGACY_IMAGES = 4

function offersModernAlternative(ctx: CheckContext, img: ReturnType<CheckContext['$']>): boolean {
  if (MODERN.test(img.attr('srcset') ?? '')) return true

  const picture = img.closest('picture')
  if (picture.length === 0) return false

  return picture
    .find('source')
    .toArray()
    .some((source) => {
      const type = ctx.$(source).attr('type') ?? ''
      return MODERN.test(type) || MODERN.test(ctx.$(source).attr('srcset') ?? '')
    })
}

export const imageFormatsCheck: Check = {
  id: ID,
  category: 'performance',
  title: 'Image formats',

  run(ctx) {
    const legacy: string[] = []

    for (const el of ctx.$('img[src]').toArray()) {
      const img = ctx.$(el)
      const src = img.attr('src') ?? ''
      if (!LEGACY.test(src)) continue
      if (offersModernAlternative(ctx, img)) continue
      legacy.push(src)
    }

    if (legacy.length < MIN_LEGACY_IMAGES) return []

    return [
      {
        checkId: ID,
        category: 'performance',
        severity: 'info',
        title: `${legacy.length} images served only as JPEG or PNG`,
        description:
          `This page loads ${legacy.length} images in legacy formats with no WebP or AVIF alternative ` +
          'offered. Those formats are 25–50% smaller at the same visual quality and are supported by ' +
          'every browser still in use, so on an image-heavy page the difference is most of the weight.',
        evidence: { images: legacy.slice(0, 8), total: legacy.length },
        remediation:
          'Serve WebP or AVIF, either through an image CDN or a <picture> element with legacy fallbacks.',
        fixPrompt:
          `This page serves ${legacy.length} images as JPEG/PNG only. Prefer whatever already exists ` +
          'in the stack: Next.js `next/image` and most image CDNs negotiate the format automatically ' +
          'from the Accept header, which is one change rather than one per image. Otherwise wrap each ' +
          'in <picture> with <source type="image/avif">, <source type="image/webp"> and the existing ' +
          '<img> as the fallback. Keep the fallback — it is what makes this safe.',
      } satisfies Finding,
    ]
  },
}
