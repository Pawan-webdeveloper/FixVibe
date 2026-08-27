/**
 * The server-rendered shape of the standard ScanForm.
 *
 * Used as a placeholder until the Convex auth context has hydrated on the
 * client, so the page's HTML does not depend on the Convex client and the
 * auth-gated behaviour (useConvexAuth) never runs during SSR. Pixels are
 * identical to ScanForm: same label, same input + button, same error
 * reserve. Only the behaviour is missing.
 */
export function ScanFormSkeleton() {
  return (
    <form noValidate className="w-full">
      <label className="block text-sm font-medium">Website address</label>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="example.com"
          className="min-w-0 flex-1 border border-line bg-surface px-4 py-3 font-mono text-base text-ink placeholder:text-muted"
        />

        <button
          type="button"
          disabled
          className="bg-accent px-6 py-3 text-base font-medium text-accent-ink"
        >
          Scan
        </button>
      </div>

      <p className="mt-2 min-h-5 text-sm text-danger" aria-hidden="true" />
    </form>
  )
}
