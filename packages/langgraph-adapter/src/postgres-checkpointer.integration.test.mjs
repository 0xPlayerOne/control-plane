import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import process from 'node:process'
import { LangGraphPostgresCheckpointProvider } from './postgres-checkpointer.ts'

const enabled = process.env.RUN_DATABASE_INTEGRATION === 'true'
const connectionString = process.env.DATABASE_MIGRATION_URL

describe.skipIf(!enabled)('LangGraph PostgreSQL checkpointer', () => {
  let provider
  const threadId = `m8-checkpoint-${process.pid}`

  beforeAll(async () => {
    if (!connectionString) throw new Error('DATABASE_MIGRATION_URL_REQUIRED')
    provider = LangGraphPostgresCheckpointProvider.fromConnectionString(connectionString)
    await provider.setup()
  })

  afterAll(async () => {
    await provider?.deleteThread(threadId)
    await provider?.close()
  })

  test('persists checkpoint state across provider restart with graph lineage metadata', async () => {
    const config = { configurable: { thread_id: threadId } }
    const checkpoint = {
      v: 4,
      id: '1f06b7a0-1234-6000-8000-000000000001',
      ts: '2026-08-25T13:00:00.000Z',
      channel_values: { state: { phase: 'approval' } },
      channel_versions: { state: 1 },
      versions_seen: { manager: { state: 1 } },
    }
    await provider.checkpointer.put(
      config,
      checkpoint,
      {
        source: 'input',
        step: 1,
        parents: {},
        graphDefinitionId: 'manager-graph',
        graphVersion: '1.0.0',
      },
      { state: 1 }
    )
    await provider.close()

    provider = LangGraphPostgresCheckpointProvider.fromConnectionString(connectionString)
    const recovered = await provider.latest(threadId)
    expect(recovered).toMatchObject({
      checkpointId: checkpoint.id,
      threadId,
      metadata: { graphDefinitionId: 'manager-graph', graphVersion: '1.0.0' },
    })
    expect(recovered.state).toEqual({ state: { phase: 'approval' } })
  })
})
