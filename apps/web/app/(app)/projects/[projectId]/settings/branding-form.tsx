'use client'

/*
 * Project settings form — branding + robots policy.
 *
 * Pure form UI; the server action handles validation + write. State is
 * local because there is no global concern: the page is the only
 * place these settings live, and the server re-renders on save.
 */

import { useState, useTransition } from 'react'
import { updateBrandingAction, type BrandingActionResult } from './actions.ts'

interface BrandingFormProps {
  projectId: string
  initial: {
    logoUrl: string | null
    brandColor: string | null
    robotsIndexable: boolean
  }
  /** Status page slug — for the "View public page" link. */
  statusSlug: string
}

export function BrandingForm({ projectId, initial, statusSlug }: BrandingFormProps) {
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? '')
  const [brandColor, setBrandColor] = useState(initial.brandColor ?? '')
  const [robotsIndexable, setRobotsIndexable] = useState(initial.robotsIndexable)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaved(false)

    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result: BrandingActionResult = await updateBrandingAction(projectId, formData)
      if (!result.ok) {
        setError(result.error ?? 'Could not save settings')
        return
      }
      setSaved(true)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field
        label="Logo URL"
        help="Optional. https:// URL or a base64 data: URL. Shown next to the project name on the status page."
      >
        <input
          type="url"
          name="logoUrl"
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          placeholder="https://cdn.example.com/logo.png"
          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
        />
      </Field>

      <Field
        label="Brand colour"
        help="Optional. 6-digit hex (#RRGGBB). Used for the status dot and a subtle banner border."
      >
        <div className="flex items-center gap-2">
          <input
            type="color"
            name="brandColor"
            value={brandColor.length > 0 ? brandColor : '#000000'}
            onChange={(e) => setBrandColor(e.target.value.toUpperCase())}
            className="h-9 w-12 cursor-pointer rounded-md border border-gray-200"
            aria-label="Pick brand colour"
          />
          <input
            type="text"
            value={brandColor}
            onChange={(e) => setBrandColor(e.target.value)}
            placeholder="#1A73E8"
            maxLength={7}
            pattern="^#[0-9a-fA-F]{6}$"
            className="w-32 rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-sm"
          />
          {brandColor.length > 0 && (
            <button
              type="button"
              onClick={() => setBrandColor('')}
              className="text-xs text-gray-500 underline"
            >
              Clear
            </button>
          )}
        </div>
      </Field>

      <Field
        label="Search engine indexing"
        help="When off, the public status page emits a noindex meta tag. Useful for projects you do not want surfaced in search results."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="robotsIndexable"
            checked={robotsIndexable}
            onChange={(e) => setRobotsIndexable(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          <span>Indexable (recommended)</span>
        </label>
      </Field>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {saved && (
        <p
          role="status"
          data-testid="branding-saved"
          className="text-sm text-emerald-600"
        >
          Saved.
        </p>
      )}

      <div className="flex items-center justify-between border-t border-gray-100 pt-4">
        <a
          href={`/status/${statusSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          View public status page ↗
        </a>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  help,
  children,
}: {
  label: string
  help: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
      <p className="mt-1 text-xs text-gray-500">{help}</p>
    </div>
  )
}
