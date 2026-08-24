/**
 * @darvin/db — public surface.
 *
 * Consumers get the client, the schema (for types and for drizzle-kit), and
 * the query modules. They should never build SQL themselves: a query that
 * lives outside queries/ is a query nobody audited for who is allowed to run it.
 */

export { db, type Database } from './client.ts'
export * from './schema.ts'
export * from './queries/viewer.ts'
export * from './queries/scans.ts'
export * from './queries/users.ts'
export * from './queries/projects.ts'
export * from './queries/subscriptions.ts'
