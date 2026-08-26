import {
  ReleaseAuditRecordSchema,
  type ReleaseAuditRecord,
  type ReleaseAuditRepository,
} from '@control-plane/production-readiness'
import { asc, eq } from 'drizzle-orm'
import type { ControlPlaneDatabase } from './connection.js'
import { releaseAuditRecords } from './schema/evaluations.js'

export class PostgresReleaseAuditRepository implements ReleaseAuditRepository {
  constructor(readonly database: ControlPlaneDatabase) {}

  async append(value: ReleaseAuditRecord): Promise<void> {
    const record = ReleaseAuditRecordSchema.parse(value)
    const inserted = await this.database
      .insert(releaseAuditRecords)
      .values(toReleaseAuditRow(record))
      .onConflictDoNothing()
      .returning({ releaseAuditId: releaseAuditRecords.releaseAuditId })
    if (inserted.length === 1) return
    const [current] = await this.database
      .select()
      .from(releaseAuditRecords)
      .where(eq(releaseAuditRecords.releaseAuditId, record.releaseAuditId))
    if (current === undefined) throw new Error('RELEASE_AUDIT_SAVE_RACE')
    if (JSON.stringify(fromReleaseAuditRow(current)) !== JSON.stringify(record)) {
      throw new Error('RELEASE_AUDIT_CONFLICT')
    }
  }

  async list(releaseGateId?: string): Promise<readonly ReleaseAuditRecord[]> {
    const query = this.database
      .select()
      .from(releaseAuditRecords)
      .orderBy(asc(releaseAuditRecords.sequence))
    const rows =
      releaseGateId === undefined
        ? await query
        : await query.where(eq(releaseAuditRecords.releaseGateId, releaseGateId))
    return rows.map(fromReleaseAuditRow)
  }
}

type ReleaseAuditRow = typeof releaseAuditRecords.$inferSelect

export function toReleaseAuditRow(
  value: ReleaseAuditRecord
): typeof releaseAuditRecords.$inferInsert {
  const record = ReleaseAuditRecordSchema.parse(value)
  return {
    releaseAuditId: record.releaseAuditId,
    releaseGateId: record.releaseGateId,
    action: record.action,
    evidence: record,
    createdAt: new Date(record.at),
  }
}

export function fromReleaseAuditRow(row: ReleaseAuditRow): ReleaseAuditRecord {
  const record = ReleaseAuditRecordSchema.parse(row.evidence)
  if (
    row.releaseAuditId !== record.releaseAuditId ||
    row.releaseGateId !== record.releaseGateId ||
    row.action !== record.action ||
    row.createdAt.toISOString() !== record.at
  ) {
    throw new Error('RELEASE_AUDIT_ROW_INCONSISTENT')
  }
  return record
}
