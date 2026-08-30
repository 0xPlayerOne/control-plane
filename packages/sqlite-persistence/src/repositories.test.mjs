import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { CommandInboxService } from '@control-plane/domain'
import { SqliteCommandAcceptanceRepository, SqlitePersistenceProvider } from './index.ts'

const ids = {
  commandId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  requestId: 'req_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  workspaceId: 'wsp_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  projectId: 'prj_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  taskId: 'tsk_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  agentId: 'agt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  executionId: 'exe_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  executionPlanId: 'pln_01ARZ3NDEKTSV4RRFFQ69G5FAV',
}

const receivedAt = '2026-08-24T10:00:00.000Z'

function commandInput(overrides = {}) {
  return {
    callerPrincipalId: 'svc_agent-hq',
    operation: 'execution.accept',
    commandId: ids.commandId,
    requestId: ids.requestId,
    idempotencyKey: 'task-submit-0001',
    payloadHash: 'a'.repeat(64),
    correlation: {
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      taskId: ids.taskId,
      agentId: ids.agentId,
    },
    executionPlan: {
      executionPlanId: ids.executionPlanId,
      contentDigest: `sha256:${'b'.repeat(64)}`,
      schemaVersion: 1,
    },
    receivedAt,
    retentionExpiresAt: '2026-09-23T10:00:00.000Z',
    ...overrides,
  }
}

function service(provider) {
  return new CommandInboxService({
    repository: new SqliteCommandAcceptanceRepository(provider),
    executionIdFactory: () => ids.executionId,
    executionPlanValidator: { validate: async () => true },
    now: () => receivedAt,
  })
}

describe('SQLite domain repositories', () => {
  test('serializes concurrent acceptance and replays it after a full reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'control-plane-sqlite-domain-'))
    const path = join(directory, 'control-plane.sqlite')
    let provider = new SqlitePersistenceProvider({ path })
    try {
      await provider.migrate()
      const accepted = await Promise.all(
        Array.from({ length: 8 }, () => service(provider).acceptExecution(commandInput()))
      )
      expect(accepted.filter(({ replayed }) => !replayed)).toHaveLength(1)
      expect(new Set(accepted.map(({ execution }) => execution.executionId))).toEqual(
        new Set([ids.executionId])
      )
      provider.close()

      provider = new SqlitePersistenceProvider({ path })
      await provider.migrate()
      const replay = await service(provider).acceptExecution(commandInput())
      expect(replay).toMatchObject({ replayed: true, execution: { executionId: ids.executionId } })

      await expect(
        service(provider).acceptExecution(commandInput({ payloadHash: 'c'.repeat(64) }))
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_CONFLICT' })
    } finally {
      provider.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
