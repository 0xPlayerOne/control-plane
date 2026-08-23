import type { DatabaseCredentials } from '@control-plane/config'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

export type ControlPlaneDatabase = PostgresJsDatabase<typeof schema>

export interface PostgresConnectionOptions {
  readonly maxConnections?: number
  readonly idleTimeoutSeconds?: number
}

export interface PostgresConnection {
  readonly database: ControlPlaneDatabase
  close(): Promise<void>
}

export class DatabaseConnectionError extends Error {
  readonly diagnostic: Readonly<Record<string, unknown>>

  constructor(code: 'INVALID_CREDENTIAL_ROLE' | 'INVALID_DATABASE_URL') {
    super('PostgreSQL connection configuration is invalid')
    this.name = 'DatabaseConnectionError'
    this.diagnostic = { code }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { name: this.name, message: this.message, diagnostic: this.diagnostic }
  }
}

export function createPostgresConnection(
  credentials: DatabaseCredentials<'application'>,
  options: PostgresConnectionOptions = {}
): PostgresConnection {
  if (credentials.role !== 'application')
    throw new DatabaseConnectionError('INVALID_CREDENTIAL_ROLE')
  assertPostgresUrl(credentials.url)
  const client = postgres(credentials.url, {
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    max: options.maxConnections ?? 10,
    prepare: false,
  })
  return {
    database: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  }
}

export function assertPostgresUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new DatabaseConnectionError('INVALID_DATABASE_URL')
  }
  if (
    (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
    url.hostname &&
    url.username &&
    url.pathname.length > 1
  ) {
    return
  }
  throw new DatabaseConnectionError('INVALID_DATABASE_URL')
}
