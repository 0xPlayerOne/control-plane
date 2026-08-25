import {
  RuntimeInventoryCheckpointSchema,
  type RuntimeInventoryCheckpoint,
  type RuntimeInventoryCheckpointRepository,
} from '@control-plane/runtime-sdk'
import { and, eq } from 'drizzle-orm'
import type { ControlPlaneDatabase } from './connection.js'
import { runtimeInventoryCheckpoints } from './schema/runtime-inventory-checkpoints.js'

export class PostgresRuntimeInventoryCheckpointRepository implements RuntimeInventoryCheckpointRepository {
  constructor(readonly database: ControlPlaneDatabase) {}

  async get(runtimeNodeRefId: string): Promise<RuntimeInventoryCheckpoint | undefined> {
    const [row] = await this.database
      .select()
      .from(runtimeInventoryCheckpoints)
      .where(eq(runtimeInventoryCheckpoints.runtimeNodeRefId, runtimeNodeRefId))
      .limit(1)
    return row === undefined
      ? undefined
      : RuntimeInventoryCheckpointSchema.parse({
          ...row,
          observedAt: row.observedAt.toISOString(),
        })
  }

  async compareAndSet(
    expectedRevision: number | undefined,
    checkpointInput: RuntimeInventoryCheckpoint
  ): Promise<boolean> {
    const checkpoint = RuntimeInventoryCheckpointSchema.parse(checkpointInput)
    const values = {
      runtimeNodeRefId: checkpoint.runtimeNodeRefId,
      workspaceId: checkpoint.workspaceId,
      snapshotVersion: checkpoint.snapshotVersion,
      snapshotDigest: checkpoint.snapshotDigest,
      observedAt: new Date(checkpoint.observedAt),
      activeRuntimeRefs: checkpoint.activeRuntimeRefs,
      revision: checkpoint.revision,
    }
    if (expectedRevision === undefined) {
      const inserted = await this.database
        .insert(runtimeInventoryCheckpoints)
        .values(values)
        .onConflictDoNothing()
        .returning({ runtimeNodeRefId: runtimeInventoryCheckpoints.runtimeNodeRefId })
      return inserted.length === 1
    }
    const updated = await this.database
      .update(runtimeInventoryCheckpoints)
      .set(values)
      .where(
        and(
          eq(runtimeInventoryCheckpoints.runtimeNodeRefId, checkpoint.runtimeNodeRefId),
          eq(runtimeInventoryCheckpoints.revision, expectedRevision)
        )
      )
      .returning({ runtimeNodeRefId: runtimeInventoryCheckpoints.runtimeNodeRefId })
    return updated.length === 1
  }
}
