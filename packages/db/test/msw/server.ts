/**
 * MSW server instance for db package tests.
 *
 * Usage:
 *   import { server } from '../msw/server.js'
 *
 *   beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
 *   afterAll(() => server.close())
 *   afterEach(() => server.resetHandlers())
 */

export { server } from './handlers.js'
