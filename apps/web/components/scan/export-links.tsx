/**
 * Downloading the report.
 *
 * Plain anchors, no JavaScript. A download is what a link IS, and routing it
 * through a fetch would mean building a Blob, a synthetic click and an object
 * URL to reproduce behaviour the browser already has — plus a spinner to hide
 * the fact that it now takes longer.
 *
 * `download` is set even though the route sends Content-Disposition:
 * attachment. The header is the one that actually decides, and it has to,
 * because the attribute is ignored cross-origin — but keeping both means the
 * filename is right in every browser and the intent is readable in the markup.
 */

const FORMATS: ReadonlyArray<{ format: string; label: string; hint: string }> = [
  { format: 'pdf', label: 'PDF', hint: 'the printed report' },
  { format: 'csv', label: 'CSV', hint: 'one row per finding, for a spreadsheet' },
  { format: 'md', label: 'Markdown', hint: 'for a ticket or a pull request' },
]

export function ExportLinks({ scanId }: { scanId: string }) {
  return (
    <section className="mt-10 border border-line p-6">
      <h2 className="label text-ink">Export</h2>
      <p className="mt-3 max-w-[62ch] text-sm text-muted text-pretty">
        A snapshot of this scan. Re-run the scan for a current reading — a downloaded file never
        changes.
      </p>
      <ul className="mt-5 flex flex-wrap gap-3">
        {FORMATS.map(({ format, label, hint }) => (
          <li key={format}>
            <a
              href={`/api/reports/${scanId}?format=${format}`}
              download
              title={hint}
              className="label inline-flex h-11 items-center border border-line px-5
                         transition-colors duration-150 hover:bg-surface"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
