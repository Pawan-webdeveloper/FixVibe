/**
 * Testcontainers helper for integration tests with real Postgres.
 *
 * Usage:
 *   import { PostgresContainer, getTestDatabaseUrl } from '../testcontainers.js'
 *
 *   let container: PostgresContainer
 *   let db: PostgresJsDatabase
 *
 *   beforeAll(async () => {
 *     container = await PostgresContainer.start()
 *     process.env.DATABASE_URL = container.getConnectionUri()
 *     // ... initialize drizzle client
 *   })
 *
 *   afterAll(async () => {
 *     await container.stop()
 *   })
 */

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'

export class PostgresContainer {
  private static instance: StartedPostgreSqlContainer | null = null

  static async start(): Promise<StartedPostgreSqlContainer> {
    if (this.instance) {
      return this.instance
    }

    this.instance = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('scanlyfix_test')
      .withUsername('test')
      .withPassword('test')
      .start()

    return this.instance
  }

  static async stop(): Promise<void> {
    if (this.instance) {
      await this.instance.stop()
      this.instance = null
    }
  }

  static getConnectionUri(): string {
    if (!this.instance) {
      throw new Error('Container not started. Call PostgresContainer.start() first.')
    }
    return this.instance.getConnectionUri()
  }
}

/**
 * Get the test database URL from testcontainers or environment.
 */
export function getTestDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL
  }
  throw new Error(
    'DATABASE_URL not set. Run PostgresContainer.start() or set DATABASE_URL in .env',
  )
}
