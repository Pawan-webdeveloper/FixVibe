/**
 * Set-Cookie parsing, reduced to exactly what the cookie checks need: the name
 * and the three security attributes. Values are deliberately dropped — we never
 * want session tokens sitting in scan results or the database.
 */

import type { ParsedCookie } from '../types.ts'

export function parseSetCookies(headers: Headers): ParsedCookie[] {
  return headers
    .getSetCookie()
    .map(parseSetCookie)
    .filter((cookie): cookie is ParsedCookie => cookie !== null)
}

function parseSetCookie(header: string): ParsedCookie | null {
  const [nameValue, ...attributes] = header.split(';')
  const name = nameValue?.split('=')[0]?.trim()
  if (!name) return null

  let secure = false
  let httpOnly = false
  let sameSite: string | null = null

  for (const attribute of attributes) {
    const [key, value] = attribute.split('=')
    switch (key?.trim().toLowerCase()) {
      case 'secure':
        secure = true
        break
      case 'httponly':
        httpOnly = true
        break
      case 'samesite':
        // Preserve the server's exact casing — it's evidence, not config.
        sameSite = value?.trim() ?? null
        break
    }
  }

  return { name, secure, httpOnly, sameSite }
}
