import 'dotenv/config'
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
