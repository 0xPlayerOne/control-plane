import { and, eq } from 'drizzle-orm'
import {
  DelegationRecordSchema,
  type DelegationRecord,
  type DelegationRepository,
} from '@control-plane/orchestration'
import type { ControlPlaneDatabase } from './connection.js'
import { delegations } from './schema/delegations.js'

export class PostgresDelegationRepository implements DelegationRepository {
  constructor(readonly database: ControlPlaneDatabase) {}

  async insert(recordInput: DelegationRecord): Promise<boolean> {
    const record = DelegationRecordSchema.parse(recordInput)
    const inserted = await this.database
      .insert(delegations)
      .values(toRow(record))
      .onConflictDoNothing()
      .returning({ delegationId: delegations.delegationId })
    return inserted.length === 1
  }

  async get(delegationId: string): Promise<DelegationRecord | undefined> {
    const [row] = await this.database
      .select({ record: delegations.record })
      .from(delegations)
      .where(eq(delegations.delegationId, delegationId))
      .limit(1)
    return row ? DelegationRecordSchema.parse(row.record) : undefined
  }

  async findByChild(childExecutionId: string): Promise<DelegationRecord | undefined> {
    const [row] = await this.database
      .select({ record: delegations.record })
      .from(delegations)
      .where(eq(delegations.childExecutionId, childExecutionId))
      .limit(1)
    return row ? DelegationRecordSchema.parse(row.record) : undefined
  }

  async listByParent(parentExecutionId: string): Promise<readonly DelegationRecord[]> {
    const rows = await this.database
      .select({ record: delegations.record })
      .from(delegations)
      .where(eq(delegations.parentExecutionId, parentExecutionId))
      .orderBy(delegations.delegationId)
    return rows.map(({ record }) => DelegationRecordSchema.parse(record))
  }

  async compareAndSet(expectedRevision: number, recordInput: DelegationRecord): Promise<boolean> {
    const record = DelegationRecordSchema.parse(recordInput)
    const updated = await this.database
      .update(delegations)
      .set(toRow(record))
      .where(
        and(
          eq(delegations.delegationId, record.delegationId),
          eq(delegations.revision, expectedRevision),
          eq(delegations.inputDigest, record.inputDigest)
        )
      )
      .returning({ delegationId: delegations.delegationId })
    return updated.length === 1
  }
}

function toRow(record: DelegationRecord) {
  return {
    delegationId: record.delegationId,
    delegationGroupId: record.delegationGroupId ?? null,
    parentExecutionId: record.parentExecutionId,
    childExecutionId: record.childExecutionId,
    state: record.state,
    revision: record.revision,
    inputDigest: record.inputDigest,
    record,
    acceptedAt: new Date(record.acceptedAt),
    updatedAt: new Date(record.updatedAt),
  }
}
