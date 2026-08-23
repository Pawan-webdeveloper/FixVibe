/**
 * client.ts builds its pool from process.env at import time, and ESM evaluates
 * imports before any test body runs — so the .env has to be loaded here, in a
 * setup file, rather than at the top of a test.
 */
import { config } from 'dotenv'

config({ path: new URL('../../../.env', import.meta.url).pathname, quiet: true })
