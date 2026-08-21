/**
 * <html lang> — the document language. Screen readers pick a pronunciation
 * voice from it, browsers decide whether to offer translation, and hreflang
 * clusters are weaker without it.
 *
 * Low severity throughout: this is an accessibility and localisation signal,
 * not a ranking one, and it belongs to the SEO pillar only because that is the
 * check that reads the <html> element today.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'seo.lang'

/**
 * BCP 47, loosely: language(2–3) [-script(4)] [-region(2 alpha | 3 digit)]
 * [-variant…]. Loose on purpose — the goal is catching `en_US`, `EN-us!` and
 * prose ("English"), not validating the IANA registry.
 */
const BCP47 = /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?(-[a-z0-9]{1,8})*$/i

export const langCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'HTML language attribute',

  run(ctx) {
    const raw = ctx.$('html').first().attr('lang')

    if (raw === undefined) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'low',
          title: 'Missing lang attribute on <html>',
          description:
            'The root <html> element declares no language. Screen readers then guess — often reading ' +
            'English text with a synthesiser configured for another language — and browsers cannot ' +
            'reliably offer translation.',
          remediation: 'Set lang on the root element, e.g. <html lang="en">.',
          fixPrompt:
            'Add a lang attribute to the <html> element in this site\'s root layout / base template, ' +
            'using the BCP 47 tag for the content language (for example lang="en" or lang="hi").',
        } satisfies Finding,
      ]
    }

    const lang = raw.trim()

    if (!lang) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'low',
          title: 'Empty lang attribute on <html>',
          description:
            '<html lang=""> is present but empty, which assistive technology treats exactly like a ' +
            'missing attribute — usually a template variable that resolved to nothing.',
          remediation: 'Give lang a real BCP 47 value, or remove the empty attribute and hardcode one.',
          fixPrompt:
            'The <html> element on this site renders lang="" (empty). Find the template variable feeding ' +
            'it and give it a real BCP 47 tag such as "en", with a fallback when the value is missing.',
        } satisfies Finding,
      ]
    }

    if (!BCP47.test(lang)) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'info',
          title: `Language tag "${lang}" is not valid BCP 47`,
          description:
            `The lang attribute is "${lang}", which does not parse as a language tag. The most common ` +
            'cause is an underscore instead of a hyphen (en_US), which consumers do not accept.',
          evidence: { lang },
          remediation: 'Use a hyphenated BCP 47 tag, e.g. en, en-US, hi-IN, pt-BR.',
          fixPrompt:
            `This site sets <html lang="${lang}">, which is not a valid BCP 47 tag. Replace it with the ` +
            'correct hyphenated form (for example "en-US" rather than "en_US").',
        } satisfies Finding,
      ]
    }

    return []
  },
}
