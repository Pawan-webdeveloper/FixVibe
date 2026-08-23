import { config } from 'dotenv'

// drizzle-kit runs with this package as its cwd, so a bare `dotenv/config`
// would look for packages/db/.env and miss the single root .env the rest of
// the workspace shares.
config({ path: new URL('../../.env', import.meta.url).pathname })
import { defineConfig } from 'drizzle-kit'

// drizzle-kit only reads this at CLI time (generate/migrate); the runtime client
// in src/index.ts builds its own pool from the same DATABASE_URL.
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set — copy .env.example to .env first.')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  // Supabase owns the auth schema; only ever diff our own tables.
  schemaFilter: ['public'],
  verbose: true,
  strict: true,
})
