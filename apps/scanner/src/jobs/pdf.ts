/**
 * HTML in, PDF out.
 *
 * This is the answer to "which PDF library" — none. The service already runs a
 * headless Chromium for the audit jobs, and Chrome's own print pipeline is a
 * better typesetter than any Node PDF library: real text shaping, real table
 * layout, and page breaks controlled by CSS the report already has to define
 * for print anyway. Adding pdfkit would mean a second layout engine, a second
 * set of fonts, and a document that looks nothing like the report on screen.
 *
 * `printBackground` is on because the report's severity blocks ARE background
 * colour; without it a critical finding and a passing one print identically.
 */

import type { Page } from 'playwright-core'

/** A generous ceiling. A report past this is a bug, not a big site. */
const MAX_BYTES = 20 * 1024 * 1024

export async function renderPdf(page: Page): Promise<Buffer> {
  const buffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    // Chrome's default margins are wider than a report needs and push tables
    // into a second column of pages.
    margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    // The page counter is wrapped in ONE span. Chrome substitutes pageNumber
    // and totalPages in place, so leaving them as separate flex children of a
    // space-between row spreads "1 / 7" across the whole footer.
    footerTemplate:
      '<div style="width:100%;font-size:8px;font-family:monospace;color:#666;padding:0 12mm;' +
      'display:flex;justify-content:space-between;">' +
      '<span>darvin.dev</span>' +
      '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  })

  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`PDF is ${buffer.byteLength} bytes, over the ${MAX_BYTES} ceiling`)
  }
  return buffer
}
