import type { ControlPlaneDatabase } from './connection.js'

export type DomainTransaction = Parameters<Parameters<ControlPlaneDatabase['transaction']>[0]>[0]

export function withDomainTransaction<Result>(
  database: Pick<ControlPlaneDatabase, 'transaction'>,
  operation: (transaction: DomainTransaction) => Promise<Result>
): Promise<Result> {
  return database.transaction(operation, {
    accessMode: 'read write',
    deferrable: false,
    isolationLevel: 'serializable',
  })
}
