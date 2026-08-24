import {
  ReconciliationCheckpointSchema,
  type ReconciliationCheckpoint,
  type ReconciliationCheckpointRepository,
} from '@control-plane/domain'
import { and, eq } from 'drizzle-orm'
import type { ControlPlaneDatabase } from './connection.js'
import { reconciliationCheckpoints } from './schema/reconciliation.js'

export class PostgresReconciliationCheckpointRepository implements ReconciliationCheckpointRepository {
  constructor(readonly database: ControlPlaneDatabase) {}

  async getByObservationHash(hash: string): Promise<ReconciliationCheckpoint | undefined> {
    const parsedHash = ReconciliationCheckpointSchema.shape.observationHash.parse(hash)
    const [row] = await this.database
      .select()
      .from(reconciliationCheckpoints)
      .where(eq(reconciliationCheckpoints.observationHash, parsedHash))
      .limit(1)
    return row ? fromRow(row) : undefined
  }

  async insert(checkpoint: ReconciliationCheckpoint): Promise<boolean> {
    const parsed = ReconciliationCheckpointSchema.parse(checkpoint)
    const rows = await this.database
      .insert(reconciliationCheckpoints)
      .values(toRow(parsed))
      .onConflictDoNothing()
      .returning({ checkpointId: reconciliationCheckpoints.checkpointId })
    return rows.length === 1
  }

  async compareAndSet(
    expectedVersion: number,
    checkpoint: ReconciliationCheckpoint
  ): Promise<boolean> {
    const parsed = ReconciliationCheckpointSchema.parse(checkpoint)
    const rows = await this.database
      .update(reconciliationCheckpoints)
      .set({
        state: parsed.state,
        version: parsed.version,
        diagnostics: [...parsed.diagnostics],
        updatedAt: new Date(parsed.updatedAt),
        resolvedAt: parsed.resolvedAt ? new Date(parsed.resolvedAt) : null,
      })
      .where(
        and(
          eq(reconciliationCheckpoints.checkpointId, parsed.checkpointId),
          eq(reconciliationCheckpoints.version, expectedVersion)
        )
      )
      .returning({ checkpointId: reconciliationCheckpoints.checkpointId })
    return rows.length === 1
  }
}

type Row = typeof reconciliationCheckpoints.$inferSelect

function toRow(
  checkpoint: ReconciliationCheckpoint
): typeof reconciliationCheckpoints.$inferInsert {
  return {
    checkpointId: checkpoint.checkpointId,
    executionId: checkpoint.executionId,
    commandId: checkpoint.commandId,
    attemptId: checkpoint.attemptId ?? null,
    workflowId: checkpoint.workflowId ?? null,
    runtimeCommandId: checkpoint.runtimeCommandId ?? null,
    pendingEventCount: checkpoint.pendingEventCount,
    observationHash: checkpoint.observationHash,
    reason: checkpoint.reason,
    action: checkpoint.action,
    state: checkpoint.state,
    diagnostics: [...checkpoint.diagnostics],
    version: checkpoint.version,
    checkedAt: new Date(checkpoint.checkedAt),
    updatedAt: new Date(checkpoint.updatedAt),
    resolvedAt: checkpoint.resolvedAt ? new Date(checkpoint.resolvedAt) : null,
  }
}

function fromRow(row: Row): ReconciliationCheckpoint {
  return ReconciliationCheckpointSchema.parse({
    checkpointId: row.checkpointId,
    executionId: row.executionId,
    commandId: row.commandId,
    ...(row.attemptId ? { attemptId: row.attemptId } : {}),
    ...(row.workflowId ? { workflowId: row.workflowId } : {}),
    ...(row.runtimeCommandId ? { runtimeCommandId: row.runtimeCommandId } : {}),
    pendingEventCount: row.pendingEventCount,
    observationHash: row.observationHash,
    reason: row.reason,
    action: row.action,
    state: row.state,
    diagnostics: row.diagnostics,
    version: row.version,
    checkedAt: row.checkedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
  })
}
