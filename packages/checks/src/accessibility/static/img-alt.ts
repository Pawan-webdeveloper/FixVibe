/**
 * Images with no alt attribute at all.
 *
 * A screen reader meeting an <img> with no alt has nothing to say, so it falls
 * back to reading the filename — "i-m-g underscore 2 4 8 1 dot j p g" — which is
 * worse than silence.
 *
 * The calibration that matters: alt="" is CORRECT and is never reported. An
 * empty alt is how you tell assistive technology that an image is decorative
 * and should be skipped, and a checker that demands text there pushes people to
 * describe spacer graphics, which makes the page worse. Missing and empty are
 * opposite states, not degrees of the same one.
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'accessibility.img-alt'

export const imgAltCheck: Check = {
  id: ID,
  category: 'accessibility',
  title: 'Image alt text',

  run(ctx) {
    const missing: string[] = []

    for (const el of ctx.$('img').toArray()) {
      const img = ctx.$(el)
      // Present-but-empty is a decision; absent is an omission.
      if (img.attr('alt') !== undefined) continue
      // An image already given a name another way needs no alt.
      if ((img.attr('aria-label') ?? '').trim() || (img.attr('aria-labelledby') ?? '').trim()) continue
      if ((img.attr('role') ?? '').trim().toLowerCase() === 'presentation') continue
      missing.push(img.attr('src') ?? '<no src>')
    }

    if (missing.length === 0) return []

    return [
      {
        checkId: ID,
        category: 'accessibility',
        severity: 'medium',
        title: `${missing.length} image${missing.length === 1 ? '' : 's'} without an alt attribute`,
        description:
          `These images carry no alt at all, so a screen reader announces the filename instead: ` +
          `${missing.slice(0, 4).join(', ')}. Note the distinction the fix turns on — alt="" is the ` +
          'right answer for a decorative image and is not counted here. What is missing is the ' +
          'attribute itself, which leaves the decision unmade.',
        evidence: { images: missing.slice(0, 10), total: missing.length },
        remediation:
          'Give each image an alt: descriptive text when it carries meaning, alt="" when it is decorative.',
        fixPrompt:
          `${missing.length} images on this page have no alt attribute: ${missing.slice(0, 6).join(', ')}.\n\n` +
          'For each, decide which it is:\n' +
          '- It conveys information → alt describing the information, not the picture. For an image ' +
          'that is a link, describe the destination.\n' +
          '- It is decorative — a spacer, a background flourish, an icon beside text that already says ' +
          'the same thing → alt="" exactly, which tells assistive technology to skip it.\n\n' +
          'Do not write "image of" or the filename. An empty alt is a real answer; a missing one is not.',
      } satisfies Finding,
    ]
  },
}
