/**
 * MSW (Mock Service Worker) handler setup for unit tests.
 *
 * Usage in tests:
 *   import { server } from '../msw/server.js'
 *   import { http, HttpResponse } from 'msw'
 *
 *   beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
 *   afterAll(() => server.close())
 *   afterEach(() => server.resetHandlers())
 *
 *   // Override handlers per test:
 *   server.use(
 *     http.get('/api/test', () => HttpResponse.json({ data: 'mocked' }))
 *   )
 */

import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

// ─── Default Handlers ─────────────────────────────────────────────────────────
// Add common API mocks here. Tests can override with server.use().

const handlers = [
  // PageSpeed Insights API
  http.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', () => {
    return HttpResponse.json({
      lighthouseResult: {
        categories: {
          performance: { score: 0.9 },
          accessibility: { score: 0.85 },
          'best-practices': { score: 0.92 },
          seo: { score: 0.88 },
        },
        audits: {},
      },
    })
  }),

  // Generic catch-all for unhandled requests (returns 404 in test)
  http.all('*', ({ request }) => {
    console.warn(`[MSW] Unhandled request: ${request.method} ${request.url}`)
    return new HttpResponse(null, { status: 404 })
  }),
]

export const server = setupServer(...handlers)
