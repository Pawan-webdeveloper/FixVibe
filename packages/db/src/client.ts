/**
 * The database connection, on its own so query modules can import it without
 * going through the package barrel — `index.ts` re-exports the queries, and a
 * query importing the barrel back would be a cycle.
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.ts'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export const db = drizzle(pool, { schema })

export type Database = typeof db
