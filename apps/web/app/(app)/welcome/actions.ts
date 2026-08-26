'use server'

import { redirect } from 'next/navigation'
import { setUserPriorities } from '@darvin/db'
import { getViewer, safeNextPath } from '@/lib/authz.ts'
import { coveredCategories, isCoveredCategory } from '@/lib/pillars.ts'

/**
 * Record what this person wants the report to lead with.
 *
 * Two submit buttons post to this one action — "Continue" with whatever is
 * ticked, and "All of it" with everything — which is how the form offers a
 * select-all without shipping a line of JavaScript to drive six checkboxes.
 *
 * Every submitted value is narrowed against the live registry before it is
 * stored. The column is a Postgres enum, so an unrecognised pillar is not a
 * bad row, it is a write that throws — and form data is attacker-controlled by
 * definition.
 */
export async function savePrioritiesAction(formData: FormData): Promise<void> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') redirect('/login?next=/welcome')

  const chosen =
    formData.get('mode') === 'all'
      ? coveredCategories()
      : formData.getAll('priority').filter(isCoveredCategory)

  // Stored even when empty: the question was asked and answered, and null is
  // reserved for "never asked" — the state that sends someone here.
  await setUserPriorities(viewer, chosen)

  redirect(safeNextPath(typeof formData.get('next') === 'string' ? String(formData.get('next')) : null))
}
