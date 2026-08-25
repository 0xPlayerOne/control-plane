import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { z } from 'zod'

const ReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
const MetadataSchema = z
  .object({
    graphDefinitionId: ReferenceSchema.optional(),
    graphVersion: ReferenceSchema.optional(),
    contentDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    executionId: ReferenceSchema.optional(),
    workflowId: ReferenceSchema.optional(),
    workspaceId: ReferenceSchema.optional(),
    compilerVersion: ReferenceSchema.optional(),
    adapterVersion: ReferenceSchema.optional(),
  })
  .strip()

export interface RecoveredCheckpoint {
  readonly threadId: string
  readonly checkpointId: string
  readonly parentCheckpointId?: string
  readonly createdAt: string
  readonly state: Readonly<Record<string, unknown>>
  readonly metadata: z.output<typeof MetadataSchema>
}

export class CheckpointProviderError extends Error {
  constructor(readonly code: 'INVALID_DATABASE_URL' | 'CHECKPOINT_PROVIDER_FAILED') {
    super(code)
    this.name = 'CheckpointProviderError'
  }
}

export class LangGraphPostgresCheckpointProvider {
  readonly checkpointer: PostgresSaver
  #closed = false

  private constructor(checkpointer: PostgresSaver) {
    this.checkpointer = checkpointer
  }

  static fromConnectionString(connectionString: string): LangGraphPostgresCheckpointProvider {
    assertDatabaseUrl(connectionString)
    try {
      return new LangGraphPostgresCheckpointProvider(PostgresSaver.fromConnString(connectionString))
    } catch {
      throw new CheckpointProviderError('CHECKPOINT_PROVIDER_FAILED')
    }
  }

  async setup(): Promise<void> {
    this.#assertOpen()
    try {
      await this.checkpointer.setup()
    } catch {
      throw new CheckpointProviderError('CHECKPOINT_PROVIDER_FAILED')
    }
  }

  async latest(threadIdInput: string): Promise<RecoveredCheckpoint | undefined> {
    this.#assertOpen()
    const threadId = ReferenceSchema.parse(threadIdInput)
    try {
      const tuple = await this.checkpointer.getTuple({ configurable: { thread_id: threadId } })
      if (!tuple) return undefined
      const parentCheckpointId = tuple.parentConfig?.configurable?.['checkpoint_id']
      return {
        threadId,
        checkpointId: tuple.checkpoint.id,
        ...(typeof parentCheckpointId === 'string' ? { parentCheckpointId } : {}),
        createdAt: tuple.checkpoint.ts,
        state: z.record(z.string(), z.unknown()).parse(tuple.checkpoint.channel_values),
        metadata: MetadataSchema.parse(tuple.metadata ?? {}),
      }
    } catch (error) {
      if (error instanceof z.ZodError) throw error
      throw new CheckpointProviderError('CHECKPOINT_PROVIDER_FAILED')
    }
  }

  async deleteThread(threadIdInput: string): Promise<void> {
    this.#assertOpen()
    const threadId = ReferenceSchema.parse(threadIdInput)
    try {
      await this.checkpointer.deleteThread(threadId)
    } catch {
      throw new CheckpointProviderError('CHECKPOINT_PROVIDER_FAILED')
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    try {
      await this.checkpointer.end()
    } catch {
      throw new CheckpointProviderError('CHECKPOINT_PROVIDER_FAILED')
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new CheckpointProviderError('CHECKPOINT_PROVIDER_FAILED')
  }
}

function assertDatabaseUrl(input: string): void {
  try {
    const url = new URL(input)
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.pathname ||
      url.pathname === '/'
    ) {
      throw new Error('invalid')
    }
  } catch {
    throw new CheckpointProviderError('INVALID_DATABASE_URL')
  }
}
