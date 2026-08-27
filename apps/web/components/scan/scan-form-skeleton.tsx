/**
 * The standard scan form as the SERVER renders it — a working form.
 *
 * Same reasoning as hero-scan-form-skeleton.tsx: it posts to the Server Action
 * the hydrated form falls back on, so a click before hydration starts a scan
 * through a full page navigation instead of doing nothing.
 *
 * Pixels stay identical to ScanForm so the swap at hydration moves nothing.
 */
import { startScanAction } from './scan-action.ts'

export function ScanFormSkeleton() {
  return (
    <form action={startScanAction} noValidate className="w-full">
      <label htmlFor="cta-url" className="block text-sm font-medium">
        Website address
      </label>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="cta-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="example.com"
          className="min-w-0 flex-1 border border-line bg-surface px-4 py-3 font-mono text-base text-ink placeholder:text-muted"
        />

        <button type="submit" className="bg-accent px-6 py-3 text-base font-medium text-accent-ink">
          Scan
        </button>
      </div>

      {/* Reserved height, so the hydrated form's error line cannot shift this. */}
      <p className="mt-2 min-h-5 text-sm text-danger" aria-hidden="true" />
    </form>
  )
}
