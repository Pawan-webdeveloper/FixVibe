/**
 * MSW (Mock Service Worker) handler setup for db package tests.
 *
 * Usage in tests:
 *   import { server } from '../msw/server.js'
 *   import { http, HttpResponse } from 'msw'
 *
 *   beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
 *   afterAll(() => server.close())
 *   afterEach(() => server.resetHandlers())
 */

import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

// ─── Default Handlers ─────────────────────────────────────────────────────────
// Add common API mocks here. Tests can override with server.use().

const handlers = [
  // DNS-over-HTTPS (Cloudflare)
  http.get('https://cloudflare-dns.com/dns-query', () => {
    return HttpResponse.json({
      Status: 0,
      Answer: [
        { name: 'example.com', type: 1, data: '93.184.216.34' },
      ],
    })
  }),

  // Generic catch-all for unhandled requests (returns 404 in test)
  http.all('*', ({ request }) => {
    console.warn(`[MSW] Unhandled request: ${request.method} ${request.url}`)
    return new HttpResponse(null, { status: 404 })
  }),
]

export const server = setupServer(...handlers)
