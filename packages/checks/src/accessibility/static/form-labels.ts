/**
 * Form controls with no accessible name.
 *
 * An unlabelled input is announced as "edit text, blank". The user knows there
 * is a field and nothing about what belongs in it, which on a checkout or a
 * login is the end of the task rather than an inconvenience.
 *
 * A placeholder does not count and this check does not accept one. Placeholders
 * disappear the moment typing starts, are not reliably announced, and fail
 * contrast requirements in most designs — treating them as a label is the
 * single most common way a form looks labelled and is not.
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'accessibility.form-labels'

/** Controls that carry their own name from their value or content. */
const SELF_LABELLING = new Set(['hidden', 'submit', 'button', 'reset', 'image'])

export const formLabelsCheck: Check = {
  id: ID,
  category: 'accessibility',
  title: 'Form labels',

  run(ctx) {
    // axe-core audited the RENDERED accessibility tree, which sees implicit
    // roles, cross-document label associations and elements built at runtime
    // that this parser cannot. When it has spoken, this check stands down:
    // two sources reporting one defect would charge the site twice, and the
    // less accurate of the two would be setting the severity.
    if (ctx.rendered?.axe) return []

    const unlabelled: string[] = []

    for (const el of ctx.$('input, select, textarea').toArray()) {
      const field = ctx.$(el)
      const type = (field.attr('type') ?? 'text').trim().toLowerCase()
      if (SELF_LABELLING.has(type)) continue

      if ((field.attr('aria-label') ?? '').trim()) continue
      if ((field.attr('aria-labelledby') ?? '').trim()) continue
      if ((field.attr('title') ?? '').trim()) continue

      // <label for="id">, or the control nested inside its own <label>.
      const id = (field.attr('id') ?? '').trim()
      if (id && ctx.$(`label[for="${id.replace(/"/g, '\\"')}"]`).length > 0) continue
      if (field.parents('label').length > 0) continue

      const describe = field.attr('name') || field.attr('id') || `${(el as { tagName?: string }).tagName ?? 'input'}[${type}]`
      unlabelled.push(describe)
    }

    if (unlabelled.length === 0) return []

    return [
      {
        checkId: ID,
        category: 'accessibility',
        severity: 'medium',
        title: `${unlabelled.length} form field${unlabelled.length === 1 ? '' : 's'} with no label`,
        description:
          `These controls have no <label>, aria-label or aria-labelledby: ${unlabelled.slice(0, 5).join(', ')}. ` +
          'A screen reader announces each as an empty edit field. A placeholder does not fill this ' +
          'gap and is not counted — it vanishes on the first keystroke, which is exactly when someone ' +
          'is most likely to need it.',
        evidence: { fields: unlabelled.slice(0, 10), total: unlabelled.length },
        remediation: 'Give each field a <label for="…">, or an aria-label where a visible label does not fit.',
        fixPrompt:
          `These form fields on this page have no accessible name: ${unlabelled.slice(0, 6).join(', ')}.\n\n` +
          'Prefer a visible <label for="fieldId">, which helps everyone and enlarges the tap target. ' +
          'Where the design genuinely has no room — a search box with a magnifier icon — use ' +
          'aria-label="Search" on the input. Do not rely on placeholder text: it is not a label, and ' +
          'it disappears as soon as the field is used.',
      } satisfies Finding,
    ]
  },
}
