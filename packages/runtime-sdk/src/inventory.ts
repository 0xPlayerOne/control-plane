import { IdentifierSchemas } from '@control-plane/contracts'
import { z } from 'zod'
import { RuntimeConnectionIdentityDigestSchema, RuntimeTimestampSchema } from './models.js'

export const RuntimeInventoryCheckpointSchema = z
  .object({
    runtimeNodeRefId: IdentifierSchemas.runtimeNodeRefId,
    workspaceId: IdentifierSchemas.workspaceId,
    snapshotVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    snapshotDigest: RuntimeConnectionIdentityDigestSchema,
    observedAt: RuntimeTimestampSchema,
    activeRuntimeRefs: z
      .array(z.string().regex(/^nref_[0-9A-HJKMNP-TV-Z]{26}$/))
      .max(128)
      .refine((values) => new Set(values).size === values.length),
    revision: z.number().int().positive(),
  })
  .strict()

export type RuntimeInventoryCheckpoint = z.output<typeof RuntimeInventoryCheckpointSchema>

export interface RuntimeInventoryCheckpointRepository {
  get(runtimeNodeRefId: string): Promise<RuntimeInventoryCheckpoint | undefined>
  compareAndSet(
    expectedRevision: number | undefined,
    checkpoint: RuntimeInventoryCheckpoint
  ): Promise<boolean>
}

export class InMemoryRuntimeInventoryCheckpointRepository implements RuntimeInventoryCheckpointRepository {
  readonly #checkpoints = new Map<string, RuntimeInventoryCheckpoint>()

  async get(runtimeNodeRefId: string): Promise<RuntimeInventoryCheckpoint | undefined> {
    const checkpoint = this.#checkpoints.get(runtimeNodeRefId)
    return checkpoint === undefined ? undefined : structuredClone(checkpoint)
  }

  async compareAndSet(
    expectedRevision: number | undefined,
    checkpointInput: RuntimeInventoryCheckpoint
  ): Promise<boolean> {
    const checkpoint = RuntimeInventoryCheckpointSchema.parse(checkpointInput)
    const current = this.#checkpoints.get(checkpoint.runtimeNodeRefId)
    if (current?.revision !== expectedRevision) return false
    this.#checkpoints.set(checkpoint.runtimeNodeRefId, structuredClone(checkpoint))
    return true
  }
}
