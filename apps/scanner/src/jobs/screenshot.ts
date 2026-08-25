/**
 * A picture of the page, for the report.
 *
 * Not a check and never becomes a finding — nothing here is graded. It exists
 * so a report can show the customer what was actually rendered, which settles
 * more arguments about a scanner's output than any amount of prose.
 *
 * Above the fold rather than full page: a full-page capture of a long
 * marketing site is tens of megabytes of PNG that nobody scrolls, and the
 * useful question is "did the page load correctly", which the viewport answers.
 */

import type { Page } from 'playwright-core'

/** Refuse rather than return something a caller has to guess the size of. */
const MAX_BYTES = 3 * 1024 * 1024

export interface Screenshot {
  /** PNG, base64. The caller decides where it is stored, if anywhere. */
  base64: string
  bytes: number
}

export async function screenshot(page: Page): Promise<Screenshot | null> {
  const buffer = await page.screenshot({ type: 'png', fullPage: false })
  if (buffer.byteLength > MAX_BYTES) return null
  return { base64: buffer.toString('base64'), bytes: buffer.byteLength }
}
