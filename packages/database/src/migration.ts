import type { DatabaseCredentials } from '@control-plane/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { assertPostgresUrl, DatabaseConnectionError } from './connection.js'

export interface MigrationOptions {
  readonly migrationsFolder?: string
}

export async function migrateDatabase(
  credentials: DatabaseCredentials<'migration'>,
  options: MigrationOptions = {}
): Promise<void> {
  if (credentials.role !== 'migration') throw new DatabaseConnectionError('INVALID_CREDENTIAL_ROLE')
  assertPostgresUrl(credentials.url)
  const client = postgres(credentials.url, {
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  })
  try {
    await migrate(drizzle(client), {
      migrationsFolder:
        options.migrationsFolder ?? fileURLToPath(new URL('../drizzle', import.meta.url)),
    })
  } finally {
    await client.end({ timeout: 5 })
  }
}
