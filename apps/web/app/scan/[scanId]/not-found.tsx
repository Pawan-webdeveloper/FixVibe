import Link from 'next/link'

/**
 * Also the answer for a scan that exists but belongs to someone else.
 * getScanForViewer returns null in both cases on purpose: confirming that an
 * id is real, to somebody not entitled to read it, is itself a disclosure.
 */
export default function ScanNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">This scan is not available</h1>
      <p className="mt-3 text-muted text-pretty">
        The link may be mistyped, or the scan may belong to an account you are not signed in to.
      </p>
      <Link href="/" className="mt-6 inline-block text-accent">
        Scan a site
      </Link>
    </div>
  )
}
