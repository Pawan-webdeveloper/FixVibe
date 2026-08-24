/**
 * `server-only` throws on import outside a React Server Component build — that
 * is the whole point of the package, and it is what keeps lib/env.ts and
 * lib/redact.ts out of a client bundle.
 *
 * Vitest runs in plain Node, so it trips that guard on any module carrying the
 * import. Aliasing it to nothing here keeps the protection in the real build
 * while letting the logic underneath be tested.
 */
export {}
