import { loadDatabaseCredentials, type RawEnvironment } from '@control-plane/config'
import {
  createIsolatedTestDatabase,
  type IsolatedTestDatabase,
} from '@control-plane/database/testing'
import process from 'node:process'

export interface IsolatedPostgresOptions {
  readonly environment?: RawEnvironment
  readonly migrate?: boolean
}

export async function createIsolatedPostgres(
  options: IsolatedPostgresOptions = {}
): Promise<IsolatedTestDatabase> {
  const environment = options.environment ?? process.env
  const database = await createIsolatedTestDatabase({
    administration: loadDatabaseCredentials(environment, 'administration'),
    application: loadDatabaseCredentials(environment, 'application'),
    migration: loadDatabaseCredentials(environment, 'migration'),
  })
  if (options.migrate ?? true) await database.migrate()
  return database
}

export async function withIsolatedPostgres<Result>(
  operation: (database: IsolatedTestDatabase) => Result | Promise<Result>,
  options: IsolatedPostgresOptions = {}
): Promise<Result> {
  const database = await createIsolatedPostgres(options)
  try {
    return await operation(database)
  } finally {
    await database.dispose()
  }
}

export type { IsolatedTestDatabase } from '@control-plane/database/testing'
