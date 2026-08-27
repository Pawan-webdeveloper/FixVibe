'use client'

import { useState } from 'react'

/**
 * Opens Razorpay Checkout, or cancels a subscription.
 *
 * The upgrade path is a modal rather than a redirect, which is the structural
 * difference between Razorpay and Stripe from the browser's point of view:
 * there is no hosted page to send the customer to, so their script renders
 * over ours and reports back through a callback.
 *
 * Three consequences worth stating, because each is a way this breaks:
 *
 *   The script is loaded on demand, not in the app shell. It is a third-party
 *   script on every page otherwise, on a product whose own report flags
 *   exactly that.
 *
 *   `handler` is only called when payment SUCCEEDS. A dismissed modal fires
 *   `modal.ondismiss` and a declined card fires `payment.failed`; without both,
 *   the button sits on "Opening…" forever and the customer assumes the site is
 *   broken.
 *
 *   The handler's values are attacker-controlled — they arrive in the browser —
 *   so they are posted to the server and verified there. Nothing about the
 *   plan is decided on this side of the call.
 *
 * POST rather than a link for both actions: a GET that creates a subscription
 * can be triggered by an image tag on another site.
 */

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

interface CheckoutSession {
  subscriptionId: string
  keyId: string
  planName: string
  email?: string
}

interface RazorpayHandlerResponse {
  razorpay_payment_id: string
  razorpay_subscription_id: string
  razorpay_signature: string
}

interface RazorpayInstance {
  open: () => void
  on: (event: string, handler: (payload: unknown) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance
  }
}

/** Resolves once Razorpay's script has defined `window.Razorpay`. */
function loadCheckoutScript(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true)

  return new Promise((resolve) => {
    // Reuse the tag if a previous click already inserted one, so a second
    // attempt does not stack listeners on a script that is still loading.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT}"]`)
    const script = existing ?? document.createElement('script')

    script.addEventListener('load', () => resolve(Boolean(window.Razorpay)), { once: true })
    script.addEventListener('error', () => resolve(false), { once: true })

    if (!existing) {
      script.src = CHECKOUT_SCRIPT
      script.async = true
      document.body.appendChild(script)
    }
  })
}

export function BillingButton({
  action,
  label,
  variant = 'primary',
}: {
  action: 'upgrade' | 'cancel'
  label: string
  variant?: 'primary' | 'secondary'
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function post<T>(url: string, body?: unknown): Promise<T | null> {
    const response = await fetch(url, {
      method: 'POST',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    const data = (await response.json()) as T & { error?: string }
    if (!response.ok) {
      setError(data.error ?? 'Something went wrong. Please try again.')
      return null
    }
    return data
  }

  async function upgrade() {
    const session = await post<CheckoutSession>('/api/billing/checkout')
    if (!session) return setPending(false)

    if (!(await loadCheckoutScript()) || !window.Razorpay) {
      setError('Could not load the payment window. Disable any ad blocker and try again.')
      return setPending(false)
    }

    const razorpay = new window.Razorpay({
      key: session.keyId,
      subscription_id: session.subscriptionId,
      name: 'ScanlyFix',
      description: `${session.planName} — monthly`,
      ...(session.email ? { prefill: { email: session.email } } : {}),
      // Only fires on success. Everything else goes through the two handlers
      // below, which is what keeps the button from hanging.
      handler: async (response: RazorpayHandlerResponse) => {
        const verified = await post<{ plan: string }>('/api/billing/verify', response)
        // Reload rather than set local state: the plan gates server-rendered
        // content all over the app, so the whole page has to be rebuilt.
        if (verified) window.location.assign('/settings/billing?upgraded=1')
        else setPending(false)
      },
      modal: {
        ondismiss: () => {
          // Closing the modal is not an error, so no message — just give the
          // button back.
          setPending(false)
        },
      },
    })

    razorpay.on('payment.failed', () => {
      setError('That payment did not go through. Try again, or use a different method.')
      setPending(false)
    })

    razorpay.open()
  }

  async function cancel() {
    // Irreversible from this UI — resubscribing means paying again — so it is
    // confirmed rather than being one stray click away.
    if (!window.confirm('Cancel Pro at the end of the current billing period? Access continues until then.')) {
      return setPending(false)
    }
    if (await post('/api/billing/cancel')) window.location.reload()
    else setPending(false)
  }

  async function go() {
    setPending(true)
    setError(null)
    try {
      await (action === 'upgrade' ? upgrade() : cancel())
    } catch {
      setError('Could not reach the server. Check your connection.')
      setPending(false)
    }
  }

  const styles = variant === 'primary' ? 'bg-accent text-accent-ink' : 'border border-line hover:bg-surface'

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className={` px-4 py-2 text-sm font-medium disabled:opacity-60 ${styles}`}
      >
        {pending ? 'Opening…' : label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
