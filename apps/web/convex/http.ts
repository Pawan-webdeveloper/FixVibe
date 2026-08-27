/**
 * The deployment's HTTP surface: the auth routes and nothing else.
 *
 * These are what the OAuth providers redirect back to and what the browser's
 * sign-in calls reach. The application's own API stays in Next.js — this
 * deployment proves identity and holds no product data.
 */

import { httpRouter } from 'convex/server'
import { auth } from './auth.ts'

const http = httpRouter()

auth.addHttpRoutes(http)

export default http
