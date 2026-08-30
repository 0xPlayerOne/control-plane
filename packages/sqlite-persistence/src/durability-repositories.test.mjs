import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { ExecutionEventService } from '@control-plane/events'
import {
  SqliteExecutionEventRepository,
  SqlitePersistenceProvider,
  SqliteReconciliationCheckpointRepository,
  SqliteRuntimeCommandRepository,
  SqliteRuntimeInventoryCheckpointRepository,
  SqliteStatePromotionProposalRepository,
} from './index.ts'

const now = '2026-08-30T12:00:00.000Z'
const ids = {
  workspaceId: 'wsp_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  projectId: 'prj_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  executionId: 'exe_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  commandId: 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  attemptId: 'att_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  nodeId: 'rnr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  connectionId: 'rtc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
}

describe('SQLite standalone durability repositories', () => {
  test('persists promotion proposals with compare-and-set across reopen', async () => {
    await withReopen(async ({ current, reopened }) => {
      const proposal = promotionProposal()
      const repository = new SqliteStatePromotionProposalRepository(current())
      expect(await repository.insert(proposal)).toBe(true)
      expect(await repository.insert(proposal)).toBe(false)

      const approved = {
        ...proposal,
        state: 'approved',
        revision: 2,
        reviewedAt: '2026-08-30T12:01:00.000Z',
        reviewingPrincipalRef: 'principal://agent-hq/user/42',
      }
      expect(await repository.compareAndSet(1, approved)).toBe(true)
      await reopened()
      const durable = new SqliteStatePromotionProposalRepository(current())
      expect(await durable.get(proposal.proposalId)).toEqual(approved)
      expect(await durable.compareAndSet(1, { ...approved, revision: 3 })).toBe(false)
    })
  })

  test('persists ordered outbox events and publication state across reopen', async () => {
    await withReopen(async ({ current, reopened }) => {
      const repository = new SqliteExecutionEventRepository(current())
      const service = new ExecutionEventService(repository)
      const event = await service.append(eventDraft())
      const failed = await service.recordPublicationFailure({
        eventId: event.eventId,
        expectedPublicationVersion: 1,
        attemptedAt: '2026-08-30T12:01:00.000Z',
        errorReference: 'delivery://agent-hq/unavailable',
      })
      expect(failed.publication).toMatchObject({ status: 'failed', version: 2 })

      await reopened()
      const durable = new SqliteExecutionEventRepository(current())
      expect(await durable.queryAfter(ids.executionId, 0, 10)).toEqual([failed])
      expect(await durable.queryPending(10, '2026-08-30T12:10:00.000Z')).toEqual([failed])
      expect(await durable.append(eventDraft())).toBeUndefined()
    })
  })

  test('persists reconciliation decisions with observation-hash CAS across reopen', async () => {
    await withReopen(async ({ current, reopened }) => {
      const checkpoint = reconciliationCheckpoint()
      const repository = new SqliteReconciliationCheckpointRepository(current())
      expect(await repository.insert(checkpoint)).toBe(true)
      expect(await repository.insert(checkpoint)).toBe(false)
      const resolved = {
        ...checkpoint,
        state: 'resolved',
        version: 2,
        updatedAt: '2026-08-30T12:02:00.000Z',
        resolvedAt: '2026-08-30T12:02:00.000Z',
      }
      expect(await repository.compareAndSet(1, resolved)).toBe(true)

      await reopened()
      const durable = new SqliteReconciliationCheckpointRepository(current())
      expect(await durable.getByObservationHash(checkpoint.observationHash)).toEqual(resolved)
      expect(await durable.compareAndSet(1, { ...resolved, version: 3 })).toBe(false)
    })
  })

  test('persists runtime commands and inventory checkpoints across reopen', async () => {
    await withReopen(async ({ current, reopened }) => {
      const command = runtimeCommand()
      const commands = new SqliteRuntimeCommandRepository(current())
      expect((await commands.create(command)).outcome).toBe('created')
      expect((await commands.create(command)).outcome).toBe('duplicate')
      expect(
        (await commands.create({ ...command, payloadHash: `sha256:${'b'.repeat(64)}` })).outcome
      ).toBe('conflict')

      const checkpoint = runtimeInventoryCheckpoint()
      const inventory = new SqliteRuntimeInventoryCheckpointRepository(current())
      expect(await inventory.compareAndSet(undefined, checkpoint)).toBe(true)

      await reopened()
      const durableCommands = new SqliteRuntimeCommandRepository(current())
      const durableInventory = new SqliteRuntimeInventoryCheckpointRepository(current())
      expect(await durableCommands.listDispatchable(ids.nodeId, now, 10)).toEqual([command])
      expect(await durableInventory.get(ids.nodeId)).toEqual(checkpoint)
      expect(await durableInventory.compareAndSet(2, { ...checkpoint, revision: 2 })).toBe(false)
    })
  })
})

async function withReopen(run) {
  const directory = await mkdtemp(join(tmpdir(), 'control-plane-sqlite-durability-'))
  const path = join(directory, 'control-plane.sqlite')
  let provider = new SqlitePersistenceProvider({ path })
  try {
    await provider.migrate()
    await run({
      current: () => provider,
      reopened: async () => {
        provider.close()
        provider = new SqlitePersistenceProvider({ path })
        await provider.migrate()
      },
    })
  } finally {
    provider.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function promotionProposal() {
  return {
    proposalId: 'spp_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    revision: 1,
    baseRevision: 0,
    sourceExecutionId: ids.executionId,
    operations: [
      {
        kind: 'append',
        item: {
          itemId: 'psi_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          key: 'finding',
          value: 'tests pass',
          sensitivity: 'internal',
          freshness: { observedAt: now },
          provenance: {
            sourceKind: 'execution',
            sourceExecutionId: ids.executionId,
            sourcePrincipalRef: 'principal://control-plane/runtime-worker',
            artifactRefs: [],
            capturedAt: now,
          },
        },
      },
    ],
    state: 'candidate',
    createdAt: now,
    expiresAt: '2026-08-31T12:00:00.000Z',
  }
}

function eventDraft() {
  return {
    eventId: 'evt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    executionId: ids.executionId,
    type: 'execution.progressed',
    schemaVersion: 1,
    correlation: {
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      taskId: 'tsk_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      agentId: 'agt_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      requestId: 'req_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      commandId: ids.commandId,
      traceId: 'trc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    },
    payload: { progress: 25 },
    occurredAt: now,
    recordedAt: now,
    retentionExpiresAt: '2026-11-30T12:00:00.000Z',
  }
}

function reconciliationCheckpoint() {
  return {
    checkpointId: `rcp_${'a'.repeat(32)}`,
    executionId: ids.executionId,
    commandId: ids.commandId,
    attemptId: ids.attemptId,
    pendingEventCount: 1,
    observationHash: 'b'.repeat(64),
    reason: 'terminal_undelivered',
    action: 'replay_events',
    state: 'reconciling',
    diagnostics: ['one pending event'],
    version: 1,
    checkedAt: now,
    updatedAt: now,
  }
}

function runtimeCommand() {
  return {
    commandId: ids.commandId,
    executionId: ids.executionId,
    attemptId: ids.attemptId,
    nodeId: ids.nodeId,
    runtimeConnectionId: ids.connectionId,
    workspaceId: ids.workspaceId,
    idempotencyKey: 'runtime-command:test:1',
    payloadHash: `sha256:${'a'.repeat(64)}`,
    commandEnvelope: { type: 'command', payload: { operation: 'run' } },
    issuedAt: now,
    expiresAt: '2026-08-30T12:10:00.000Z',
    status: 'queued',
    version: 1,
    deliveryAttempts: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function runtimeInventoryCheckpoint() {
  return {
    runtimeNodeRefId: ids.nodeId,
    workspaceId: ids.workspaceId,
    snapshotVersion: 1,
    snapshotDigest: `sha256:${'c'.repeat(64)}`,
    observedAt: now,
    activeRuntimeRefs: ['nref_01ARZ3NDEKTSV4RRFFQ69G5FAV'],
    revision: 1,
  }
}
