import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { JsonValue, PersistenceProvider } from '@control-plane/deployment'
import {
  ReconciliationCheckpointSchema,
  RuntimeCommandRecordSchema,
  StatePromotionProposalSchema,
  runtimeCommandRecordsShareIdentity,
  type ReconciliationCheckpoint,
  type ReconciliationCheckpointRepository,
  type RuntimeCommandCreateResult,
  type RuntimeCommandRecord,
  type RuntimeCommandRepository,
  type StatePromotionProposal,
  type StatePromotionProposalRepository,
} from '@control-plane/domain'
import {
  ExecutionEventDraftSchema,
  ExecutionEventSchema,
  hashExecutionEventPayload,
  type ExecutionEvent,
  type ExecutionEventDraft,
  type ExecutionEventRepository,
} from '@control-plane/events'
import {
  RuntimeInventoryCheckpointSchema,
  type RuntimeInventoryCheckpoint,
  type RuntimeInventoryCheckpointRepository,
} from '@control-plane/runtime-sdk'

const namespaces = {
  events: 'execution-events',
  proposals: 'state-promotion-proposals',
  reconciliation: 'reconciliation-checkpoints',
  runtimeCommands: 'runtime-commands',
  runtimeInventory: 'runtime-inventory-checkpoints',
} as const

export class SqliteStatePromotionProposalRepository implements StatePromotionProposalRepository {
  constructor(readonly provider: PersistenceProvider) {}

  insert(input: StatePromotionProposal): Promise<boolean> {
    const proposal = StatePromotionProposalSchema.parse(input)
    return this.provider.transaction(async (transaction) => {
      const id = recordId(proposal.proposalId)
      if ((await transaction.get(namespaces.proposals, id)) !== undefined) return false
      await transaction.put({ namespace: namespaces.proposals, id, value: json(proposal) })
      return true
    })
  }

  get(proposalId: string): Promise<StatePromotionProposal | undefined> {
    StatePromotionProposalSchema.shape.proposalId.parse(proposalId)
    return this.provider.transaction(async (transaction) => {
      const record = await transaction.get(namespaces.proposals, recordId(proposalId))
      return record === undefined ? undefined : StatePromotionProposalSchema.parse(record.value)
    })
  }

  compareAndSet(expectedRevision: number, input: StatePromotionProposal): Promise<boolean> {
    const proposal = StatePromotionProposalSchema.parse(input)
    return this.provider.transaction(async (transaction) => {
      const id = recordId(proposal.proposalId)
      const record = await transaction.get(namespaces.proposals, id)
      if (record === undefined) return false
      const current = StatePromotionProposalSchema.parse(record.value)
      if (current.revision !== expectedRevision || !sameProposalIdentity(current, proposal)) {
        return false
      }
      await transaction.put({
        namespace: namespaces.proposals,
        id,
        expectedRevision: record.revision,
        value: json(proposal),
      })
      return true
    })
  }
}

export class SqliteExecutionEventRepository implements ExecutionEventRepository {
  constructor(readonly provider: PersistenceProvider) {}

  append(input: ExecutionEventDraft): Promise<ExecutionEvent | undefined> {
    const draft = ExecutionEventDraftSchema.parse(input)
    return this.provider.transaction(async (transaction) => {
      const id = recordId(draft.eventId)
      if ((await transaction.get(namespaces.events, id)) !== undefined) return undefined
      const sequence =
        (await transaction.list(namespaces.events))
          .map((record) => ExecutionEventSchema.parse(record.value))
          .filter((event) => event.executionId === draft.executionId)
          .reduce((maximum, event) => Math.max(maximum, event.sequence), 0) + 1
      const event = ExecutionEventSchema.parse({
        ...draft,
        sequence,
        payloadBytes: Buffer.byteLength(JSON.stringify(draft.payload)),
        payloadHash: hashExecutionEventPayload(draft.payload),
        publication: { status: 'pending', attempts: 0, version: 1 },
      })
      await transaction.put({ namespace: namespaces.events, id, value: json(event) })
      return event
    })
  }

  get(eventId: string): Promise<ExecutionEvent | undefined> {
    ExecutionEventSchema.shape.eventId.parse(eventId)
    return this.provider.transaction(async (transaction) => {
      const record = await transaction.get(namespaces.events, recordId(eventId))
      return record === undefined ? undefined : ExecutionEventSchema.parse(record.value)
    })
  }

  queryAfter(executionId: string, afterSequence: number, limit: number) {
    validLimit(limit)
    return this.provider.transaction(async (transaction) =>
      (await transaction.list(namespaces.events))
        .map((record) => ExecutionEventSchema.parse(record.value))
        .filter(
          (event) =>
            event.executionId === executionId &&
            event.sequence > afterSequence &&
            event.archivedAt === undefined
        )
        .sort((left, right) => left.sequence - right.sequence)
        .slice(0, limit)
    )
  }

  queryPending(limit: number, dueAt?: string) {
    validLimit(limit)
    if (dueAt !== undefined && Number.isNaN(Date.parse(dueAt))) throw new Error('INVALID_TIMESTAMP')
    return this.provider.transaction(async (transaction) =>
      (await transaction.list(namespaces.events))
        .map((record) => ExecutionEventSchema.parse(record.value))
        .filter(
          (event) =>
            ['pending', 'failed'].includes(event.publication.status) &&
            event.archivedAt === undefined &&
            (dueAt === undefined ||
              event.publication.nextAttemptAt === undefined ||
              event.publication.nextAttemptAt <= dueAt)
        )
        .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
        .slice(0, limit)
    )
  }

  compareAndSetPublication(expectedVersion: number, input: ExecutionEvent): Promise<boolean> {
    const event = ExecutionEventSchema.parse(input)
    return this.provider.transaction(async (transaction) => {
      const id = recordId(event.eventId)
      const record = await transaction.get(namespaces.events, id)
      if (record === undefined) return false
      const current = ExecutionEventSchema.parse(record.value)
      if (current.publication.version !== expectedVersion || !sameEventIdentity(current, event)) {
        return false
      }
      await transaction.put({
        namespace: namespaces.events,
        id,
        expectedRevision: record.revision,
        value: json(event),
      })
      return true
    })
  }

  archive(eventId: string, archivedAt: string): Promise<ExecutionEvent | undefined> {
    if (Number.isNaN(Date.parse(archivedAt))) throw new Error('INVALID_TIMESTAMP')
    return this.provider.transaction(async (transaction) => {
      const id = recordId(eventId)
      const record = await transaction.get(namespaces.events, id)
      if (record === undefined) return undefined
      const archived = ExecutionEventSchema.parse({
        ...ExecutionEventSchema.parse(record.value),
        archivedAt,
      })
      await transaction.put({
        namespace: namespaces.events,
        id,
        expectedRevision: record.revision,
        value: json(archived),
      })
      return archived
    })
  }
}

export class SqliteReconciliationCheckpointRepository implements ReconciliationCheckpointRepository {
  constructor(readonly provider: PersistenceProvider) {}

  getByObservationHash(hash: string): Promise<ReconciliationCheckpoint | undefined> {
    ReconciliationCheckpointSchema.shape.observationHash.parse(hash)
    return this.provider.transaction(async (transaction) => {
      const record = await transaction.get(namespaces.reconciliation, recordId(hash))
      return record === undefined ? undefined : ReconciliationCheckpointSchema.parse(record.value)
    })
  }

  insert(input: ReconciliationCheckpoint): Promise<boolean> {
    const checkpoint = ReconciliationCheckpointSchema.parse(input)
    return this.provider.transaction(async (transaction) => {
      const id = recordId(checkpoint.observationHash)
      if ((await transaction.get(namespaces.reconciliation, id)) !== undefined) return false
      await transaction.put({ namespace: namespaces.reconciliation, id, value: json(checkpoint) })
      return true
    })
  }

  compareAndSet(expectedVersion: number, input: ReconciliationCheckpoint): Promise<boolean> {
    const checkpoint = ReconciliationCheckpointSchema.parse(input)
    return this.provider.transaction(async (transaction) => {
      const id = recordId(checkpoint.observationHash)
      const record = await transaction.get(namespaces.reconciliation, id)
      if (record === undefined) return false
      const current = ReconciliationCheckpointSchema.parse(record.value)
      if (current.version !== expectedVersion || current.checkpointId !== checkpoint.checkpointId) {
        return false
      }
      await transaction.put({
        namespace: namespaces.reconciliation,
        id,
        expectedRevision: record.revision,
        value: json(checkpoint),
      })
      return true
    })
  }
}

export class SqliteRuntimeCommandRepository implements RuntimeCommandRepository {
  constructor(readonly provider: PersistenceProvider) {}

  create(input: RuntimeCommandRecord): Promise<RuntimeCommandCreateResult> {
    const command = RuntimeCommandRecordSchema.parse(input)
    return this.provider.transaction(async (transaction) => {
      const id = recordId(command.commandId)
      const record = await transaction.get(namespaces.runtimeCommands, id)
      if (record === undefined) {
        await transaction.put({ namespace: namespaces.runtimeCommands, id, value: json(command) })
        return { outcome: 'created', record: command }
      }
      const current = RuntimeCommandRecordSchema.parse(record.value)
      return {
        outcome: runtimeCommandRecordsShareIdentity(current, command) ? 'duplicate' : 'conflict',
        record: current,
      }
    })
  }

  get(commandId: string): Promise<RuntimeCommandRecord | undefined> {
    RuntimeCommandRecordSchema.shape.commandId.parse(commandId)
    return this.provider.transaction(async (transaction) => {
      const record = await transaction.get(namespaces.runtimeCommands, recordId(commandId))
      return record === undefined ? undefined : RuntimeCommandRecordSchema.parse(record.value)
    })
  }

  compareAndSet(expectedVersion: number, input: RuntimeCommandRecord): Promise<boolean> {
    const command = RuntimeCommandRecordSchema.parse(input)
    return this.provider.transaction(async (transaction) => {
      const id = recordId(command.commandId)
      const record = await transaction.get(namespaces.runtimeCommands, id)
      if (record === undefined) return false
      const current = RuntimeCommandRecordSchema.parse(record.value)
      if (
        current.version !== expectedVersion ||
        !runtimeCommandRecordsShareIdentity(current, command)
      ) {
        return false
      }
      await transaction.put({
        namespace: namespaces.runtimeCommands,
        id,
        expectedRevision: record.revision,
        value: json(command),
      })
      return true
    })
  }

  listDispatchable(nodeId: string, at: string, limit: number): Promise<RuntimeCommandRecord[]> {
    RuntimeCommandRecordSchema.shape.nodeId.parse(nodeId)
    if (Number.isNaN(Date.parse(at))) throw new Error('INVALID_TIMESTAMP')
    validLimit(limit)
    return this.provider.transaction(async (transaction) =>
      (await transaction.list(namespaces.runtimeCommands))
        .map((record) => RuntimeCommandRecordSchema.parse(record.value))
        .filter(
          (command) =>
            command.nodeId === nodeId &&
            ['queued', 'dispatched', 'acknowledged'].includes(command.status)
        )
        .sort((left, right) =>
          left.issuedAt === right.issuedAt
            ? left.commandId.localeCompare(right.commandId)
            : left.issuedAt.localeCompare(right.issuedAt)
        )
        .slice(0, limit)
    )
  }
}

export class SqliteRuntimeInventoryCheckpointRepository implements RuntimeInventoryCheckpointRepository {
  constructor(readonly provider: PersistenceProvider) {}

  get(runtimeNodeRefId: string): Promise<RuntimeInventoryCheckpoint | undefined> {
    RuntimeInventoryCheckpointSchema.shape.runtimeNodeRefId.parse(runtimeNodeRefId)
    return this.provider.transaction(async (transaction) => {
      const record = await transaction.get(namespaces.runtimeInventory, recordId(runtimeNodeRefId))
      return record === undefined ? undefined : RuntimeInventoryCheckpointSchema.parse(record.value)
    })
  }

  compareAndSet(
    expectedRevision: number | undefined,
    input: RuntimeInventoryCheckpoint
  ): Promise<boolean> {
    const checkpoint = RuntimeInventoryCheckpointSchema.parse(input)
    return this.provider.transaction(async (transaction) => {
      const id = recordId(checkpoint.runtimeNodeRefId)
      const record = await transaction.get(namespaces.runtimeInventory, id)
      if (record === undefined) {
        if (expectedRevision !== undefined) return false
        await transaction.put({
          namespace: namespaces.runtimeInventory,
          id,
          value: json(checkpoint),
        })
        return true
      }
      const current = RuntimeInventoryCheckpointSchema.parse(record.value)
      if (current.revision !== expectedRevision || current.workspaceId !== checkpoint.workspaceId) {
        return false
      }
      await transaction.put({
        namespace: namespaces.runtimeInventory,
        id,
        expectedRevision: record.revision,
        value: json(checkpoint),
      })
      return true
    })
  }
}

function sameProposalIdentity(
  left: StatePromotionProposal,
  right: StatePromotionProposal
): boolean {
  return (
    left.proposalId === right.proposalId &&
    left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId &&
    left.baseRevision === right.baseRevision &&
    left.sourceExecutionId === right.sourceExecutionId &&
    left.createdAt === right.createdAt &&
    left.expiresAt === right.expiresAt &&
    isDeepStrictEqual(left.operations, right.operations)
  )
}

function sameEventIdentity(left: ExecutionEvent, right: ExecutionEvent): boolean {
  return (
    left.eventId === right.eventId &&
    left.executionId === right.executionId &&
    left.sequence === right.sequence &&
    left.type === right.type &&
    left.schemaVersion === right.schemaVersion &&
    left.payloadHash === right.payloadHash &&
    left.recordedAt === right.recordedAt &&
    isDeepStrictEqual(left.correlation, right.correlation)
  )
}

function validLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
    throw new Error('INVALID_LIMIT')
  }
}

function recordId(value: string): string {
  return `r-${createHash('sha256').update(value).digest('hex')}`
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}
