/**
 * URL normalization for deploy hook matching.
 *
 * Problem: CI systems send URLs with variations that should match:
 *   - example.com vs example.com/
 *   - https://example.com vs https://example.com/
 *   - www.example.com vs example.com
 *   - EXAMPLE.COM vs example.com
 *   - https://example.com:443 vs https://example.com
 *
 * Solution: normalize both URLs before comparison.
 */

/**
 * Normalizes a URL for consistent comparison.
 *
 * Steps:
 *   1. Lowercase protocol + host
 *   2. Strip trailing slash
 *   3. Strip default ports (:443 for https, :80 for http)
 *   4. Preserve path (except trailing slash)
 *
 * Returns null if the input is not a valid URL.
 */
export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw)

    // Lowercase protocol and host
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase()

    // Strip default ports
    if (url.port === '443' && url.protocol === 'https:') {
      url.port = ''
    } else if (url.port === '80' && url.protocol === 'http:') {
      url.port = ''
    }

    // Get the normalized string
    let normalized = url.toString()

    // Strip trailing slash
    // URL.toString() always adds trailing slash for root path
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1)
    }

    return normalized
  } catch {
    return null
  }
}

/**
 * Strips www. prefix from a URL's hostname.
 *
 * "https://www.example.com/path" → "https://example.com/path"
 * "https://example.com/path" → "https://example.com/path" (unchanged)
 */
export function stripWww(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4)
    }

    let result = url.toString()

    // Strip trailing slash (consistent with normalizeUrl)
    // URL.toString() always adds trailing slash for root path
    if (result.endsWith('/')) {
      result = result.slice(0, -1)
    }

    return result
  } catch {
    return null
  }
}

/**
 * Checks if two URLs match after normalization.
 *
 * Matching criteria:
 *   1. normalize(url1) === normalize(url2)
 *   2. OR stripWww(normalize(url1)) === stripWww(normalize(url2))
 *
 * This handles:
 *   - Trailing slash differences
 *   - Case differences
 *   - www. prefix differences
 *   - Default port differences
 */
export function urlsMatch(url1: string, url2: string): boolean {
  const norm1 = normalizeUrl(url1)
  const norm2 = normalizeUrl(url2)

  if (!norm1 || !norm2) return false

  // Direct match after normalization
  if (norm1 === norm2) return true

  // Match with www. stripped
  const stripped1 = stripWww(norm1)
  const stripped2 = stripWww(norm2)

  if (!stripped1 || !stripped2) return false

  return stripped1 === stripped2
}
