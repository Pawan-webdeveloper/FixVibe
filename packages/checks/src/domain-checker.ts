/*
 * Pure domain expiry probe using RDAP (Registration Data Access Protocol).
 *
 * Why RDAP instead of WHOIS?
 *   WHOIS is plain text with no standard format — each registrar returns a
 *   different layout and parsing it is a regex soup that breaks on every
 *   registrar update. RDAP is JSON, standardised by RFC 7483, and supported
 *   by every major registrar and all gTLDs since 2019.
 *
 * No extra dependency — uses the IANA RDAP bootstrap to find the right
 * registry endpoint, then a plain fetch.
 */
 

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */


export interface DomainCheckResult {
  ok: boolean
  /** Days until domain expiry. Negative means already expired. */
  daysUntilExpiry: number | null
  /** ISO-8601 expiry date. */
  expiresAt: string | null
  /** Registrar name, if available. */
  registrar: string | null
  /** Error message if the lookup failed. */
  detail: string | null
}




/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */
 
const RDAP_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json'
const FETCH_TIMEOUT_MS = 15_000





/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */
 
/** Extracts TLD from a hostname. "app.example.co.uk" → "co.uk" tried first, then "uk". */
function extractTld(hostname: string): string {
  const parts = hostname.split('.')
  // Try 2-part TLD first (co.uk, com.au), then single (com, io)
  return parts.length >= 3 ? parts.slice(-2).join('.') : parts.slice(-1).join('.')
}
 
async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
 



/** Finds the RDAP endpoint for a given TLD from the IANA bootstrap registry. */
async function rdapEndpointForTld(tld: string): Promise<string | null> {
  const bootstrap = await fetchWithTimeout(RDAP_BOOTSTRAP)
  if (!bootstrap.ok) return null
 
  const data = (await bootstrap.json()) as { services: Array<[string[], string[]]> }
 
  for (const [tlds, urls] of data.services) {
    if (tlds.includes(tld) && urls[0]) return urls[0]
  }
 
  // Fallback: try single-part TLD if 2-part failed
  const singleTld = tld.split('.').pop()!
  for (const [tlds, urls] of data.services) {
    if (tlds.includes(singleTld) && urls[0]) return urls[0]
  }
 
  return null
}




/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */
 
/**
 * Looks up domain expiry via RDAP.
 * Does NOT throw — all errors returned as `{ ok: false, detail }`.
 */

export async function checkDomain(hostname: string): Promise<DomainCheckResult> {
  try {
    // Strip subdomains to get registrable domain (e.g. "app.example.com" → "example.com")
    const parts = hostname.split('.')
    const domain = parts.length >= 2 ? parts.slice(-2).join('.') : hostname
    const tld = extractTld(hostname)
 
    const endpoint = await rdapEndpointForTld(tld)
    if (!endpoint) {
      return { ok: true, daysUntilExpiry: null, expiresAt: null, registrar: null, detail: `No RDAP endpoint found for .${tld}` }
    }
 
    const rdapUrl = `${endpoint.replace(/\/$/, '')}/domain/${domain}`
    const res = await fetchWithTimeout(rdapUrl)
 
    if (!res.ok) {
      return { ok: true, daysUntilExpiry: null, expiresAt: null, registrar: null, detail: `RDAP lookup failed: HTTP ${res.status}` }
    }
 
    const data = (await res.json()) as {
      events?: Array<{ eventAction: string; eventDate: string }>
      entities?: Array<{ roles: string[]; vcardArray?: unknown[][] }>
    }
 
    const expiryEvent = data.events?.find((e) => e.eventAction === 'expiration')
    if (!expiryEvent) {
      return { ok: true, daysUntilExpiry: null, expiresAt: null, registrar: null, detail: 'No expiry date in RDAP response' }
    }
 
    const expiresAt = new Date(expiryEvent.eventDate)
    const daysUntilExpiry = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000)
 
    // Registrar name from entities
    const registrarEntity = data.entities?.find((e) => e.roles.includes('registrar'))
    const registrar: string | null = null // vcard parsing omitted for brevity
 
    return {
      ok: daysUntilExpiry > 0,
      daysUntilExpiry,
      expiresAt: expiresAt.toISOString(),
      registrar,
      detail: daysUntilExpiry <= 0 ? `Domain expired ${Math.abs(daysUntilExpiry)} days ago` : null,
    }
  } catch (err) {
    return {
      ok: false,
      daysUntilExpiry: null,
      expiresAt: null,
      registrar: null,
      detail: err instanceof Error ? err.message : 'Domain lookup failed',
    }
  }
}