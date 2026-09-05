import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { InMemoryInteractionRepository, InteractionService } from '@control-plane/domain'
import {
  FakeMemoryProviderWriter,
  InMemoryMemoryWriteProposalRepository,
  MemoryWriteService,
} from './index.ts'

const now = '2026-08-25T12:00:00.000Z'
const later = '2026-08-25T12:01:00.000Z'
const providerId = 'ctp_01JABCDEF0123456789ABCDEFG'
const connectionId = 'ctc_01JABCDEF0123456789ABCDEFG'
const workspaceId = 'wsp_01JABCDEF0123456789ABCDEFG'
const scopeDigest = `sha256:${'a'.repeat(64)}`

describe('provider-neutral memory write proposals', () => {
  test('rejects absent and read-only providers while ordinary execution remains independent', async () => {
    await expect(harness(undefined).service.propose(proposal(), policy())).rejects.toMatchObject({
      code: 'MEMORY_PROVIDER_ABSENT',
    })
    const readOnly = provider('success', { writeCommit: false, idempotentStatus: false })
    await expect(harness(readOnly).service.propose(proposal(), policy())).rejects.toMatchObject({
      code: 'MEMORY_PROVIDER_READ_ONLY',
    })
  })

  test('keeps proposals non-canonical and deduplicates duplicate delivery', async () => {
    const writer = provider()
    const { service, repository } = harness(writer)
    const first = await service.propose(proposal(), policy())
    const duplicate = await service.propose(proposal(), policy())
    expect(first.state).toBe('proposed')
    expect(duplicate).toEqual(first)
    expect(await repository.list()).toHaveLength(1)
    expect(writer.records.size).toBe(0)
    expect(first).not.toHaveProperty('providerMemoryRef')
    await expect(service.commit(first.proposalId, later)).rejects.toMatchObject({
      code: 'MEMORY_APPROVAL_REQUIRED',
    })
  })

  test('uses durable approval, denial, expiry, and revocation lifecycles', async () => {
    const approved = harness(provider())
    const pending = await approved.service.propose(
      proposal(),
      policy({ mode: 'approval_required' }),
      approval()
    )
    expect(pending.state).toBe('awaiting_approval')
    const interactions = new InteractionService(approved.interactions)
    await interactions.respond({
      interactionId: approval().interactionId,
      executionId: proposal().provenance.sourceExecutionId,
      attemptId: proposal().provenance.sourceAttemptId,
      responseId: 'cmd_01JABCDEF0123456789ABCDEFG',
      action: 'approve',
      respondingPrincipalId: 'principal:test:approver',
      expectedVersion: 1,
      respondedAt: later,
    })
    expect((await approved.service.applyApproval(pending.proposalId, later)).state).toBe('approved')
    expect((await approved.service.revoke(pending.proposalId, later)).outcome.code).toBe('revoked')

    const denied = harness(provider())
    const deniedProposal = await denied.service.propose(
      proposal({ proposalId: 'mwp_01JBBCDEF0123456789ABCDEFG', dedupeHint: 'deny' }),
      policy({ mode: 'approval_required' }),
      approval({ interactionId: 'int_01JBBCDEF0123456789ABCDEFG' })
    )
    await new InteractionService(denied.interactions).respond({
      interactionId: deniedProposal.approvalInteractionId,
      executionId: deniedProposal.provenance.sourceExecutionId,
      attemptId: deniedProposal.provenance.sourceAttemptId,
      responseId: 'cmd_01JBBCDEF0123456789ABCDEFG',
      action: 'deny',
      respondingPrincipalId: 'principal:test:approver',
      expectedVersion: 1,
      respondedAt: later,
    })
    expect((await denied.service.applyApproval(deniedProposal.proposalId, later)).state).toBe(
      'denied'
    )

    const expired = harness(provider())
    const expiredProposal = await expired.service.propose(
      proposal({ proposalId: 'mwp_01JCCDEF0123456789ABCDEFGH', dedupeHint: 'expire' }),
      policy({ mode: 'approval_required' }),
      approval({ interactionId: 'int_01JCCDEF0123456789ABCDEFGH' })
    )
    await new InteractionService(expired.interactions).expire(
      expiredProposal.approvalInteractionId,
      '2026-08-25T12:11:00.000Z'
    )
    expect(
      (await expired.service.applyApproval(expiredProposal.proposalId, '2026-08-25T12:11:00.000Z'))
        .state
    ).toBe('expired')
  })

  test('commits with one stable idempotent effect and reconciles timeout-after-effect', async () => {
    const direct = harness(provider())
    const proposed = await prepareApproved(direct)
    const committed = await direct.service.commit(proposed.proposalId, later)
    expect(committed).toMatchObject({ state: 'committed', outcome: { code: 'committed' } })
    expect(await direct.service.commit(proposed.proposalId, later)).toEqual(committed)
    expect(direct.provider.records.size).toBe(1)

    const after = harness(provider('timeout_after'))
    const afterProposal = await prepareApproved(after, {
      proposalId: 'mwp_01JBBCDEF0123456789ABCDEFG',
      dedupeHint: 'after',
    })
    expect(await after.service.commit(afterProposal.proposalId, later)).toMatchObject({
      state: 'committed',
      outcome: { code: 'reconciled' },
    })
    expect(after.provider.records.size).toBe(1)
  })

  test('durably records rejection and ambiguous non-effects for reconciliation', async () => {
    const rejected = harness(provider('reject'))
    const rejectedProposal = await prepareApproved(rejected)
    await expect(rejected.service.commit(rejectedProposal.proposalId, later)).rejects.toMatchObject(
      {
        code: 'MEMORY_WRITE_REJECTED',
      }
    )
    expect((await rejected.repository.get(rejectedProposal.proposalId)).state).toBe('failed')

    const before = harness(provider('timeout_before'))
    const beforeProposal = await prepareApproved(before, {
      proposalId: 'mwp_01JBBCDEF0123456789ABCDEFG',
      dedupeHint: 'before',
    })
    await expect(before.service.commit(beforeProposal.proposalId, later)).rejects.toMatchObject({
      code: 'MEMORY_WRITE_AMBIGUOUS',
    })
    expect(await before.repository.get(beforeProposal.proposalId)).toMatchObject({
      state: 'reconciliation_required',
      outcome: { code: 'ambiguous' },
    })
    expect(before.provider.records.size).toBe(0)

    const nonIdempotent = harness(
      provider('ambiguous', { writeCommit: true, idempotentStatus: false })
    )
    let writeCount = 0
    const write = nonIdempotent.provider.write.bind(nonIdempotent.provider)
    nonIdempotent.provider.write = async (request) => {
      writeCount += 1
      return write(request)
    }
    const ambiguousProposal = await prepareApproved(nonIdempotent)
    await expect(
      nonIdempotent.service.commit(ambiguousProposal.proposalId, later)
    ).rejects.toMatchObject({ code: 'MEMORY_WRITE_AMBIGUOUS' })
    expect(await nonIdempotent.repository.get(ambiguousProposal.proposalId)).toMatchObject({
      state: 'reconciliation_required',
      outcome: { code: 'ambiguous' },
    })
    expect(writeCount).toBe(1)
    await expect(
      nonIdempotent.service.commit(ambiguousProposal.proposalId, later)
    ).rejects.toMatchObject({ code: 'MEMORY_WRITE_AMBIGUOUS' })
    expect(writeCount).toBe(1)
    expect(await nonIdempotent.repository.get(ambiguousProposal.proposalId)).toMatchObject({
      state: 'reconciliation_required',
      outcome: { code: 'ambiguous' },
    })
  })

  test('reconciles an ambiguous idempotent write through status without replaying the effect', async () => {
    const context = harness(provider('ambiguous'))
    let writeCount = 0
    const write = context.provider.write.bind(context.provider)
    context.provider.write = async (request) => {
      writeCount += 1
      return write(request)
    }
    let status = { status: 'unknown' }
    context.provider.status = async () => status
    let rejectNextTransition = false
    const compareAndSet = context.repository.compareAndSet.bind(context.repository)
    context.repository.compareAndSet = async (expectedVersion, next) => {
      if (rejectNextTransition) {
        rejectNextTransition = false
        return false
      }
      return compareAndSet(expectedVersion, next)
    }
    const prepared = await prepareApproved(context)

    await expect(context.service.commit(prepared.proposalId, later)).rejects.toMatchObject({
      code: 'MEMORY_WRITE_AMBIGUOUS',
    })
    expect(writeCount).toBe(1)
    status = { status: 'committed', providerMemoryRef: 'memory://reconciled' }
    rejectNextTransition = true

    await expect(context.service.commit(prepared.proposalId, later)).rejects.toMatchObject({
      code: 'MEMORY_PROPOSAL_CONFLICT',
    })
    expect(writeCount).toBe(1)
    expect((await context.repository.get(prepared.proposalId)).state).toBe(
      'reconciliation_required'
    )

    expect(await context.service.commit(prepared.proposalId, later)).toMatchObject({
      state: 'committed',
      outcome: { code: 'reconciled', providerMemoryRef: 'memory://reconciled' },
    })
    expect(writeCount).toBe(1)
  })

  test('fails a status-rejected reconciliation without replaying the write', async () => {
    const context = harness(provider('ambiguous'))
    let writeCount = 0
    const write = context.provider.write.bind(context.provider)
    context.provider.write = async (request) => {
      writeCount += 1
      return write(request)
    }
    let status = { status: 'unknown' }
    context.provider.status = async () => status
    const prepared = await prepareApproved(context)
    await expect(context.service.commit(prepared.proposalId, later)).rejects.toMatchObject({
      code: 'MEMORY_WRITE_AMBIGUOUS',
    })
    const parked = await context.repository.get(prepared.proposalId)
    status = { status: 'rejected' }

    await expect(context.service.commit(prepared.proposalId, later)).rejects.toMatchObject({
      code: 'MEMORY_WRITE_REJECTED',
    })
    expect(writeCount).toBe(1)
    expect(await context.repository.get(prepared.proposalId)).toMatchObject({
      state: 'failed',
      version: parked.version + 1,
      outcome: { code: 'failed' },
    })
  })

  test('keeps unknown and unavailable status reconciliation parked without replay', async () => {
    const context = harness(provider('ambiguous'))
    let writeCount = 0
    const write = context.provider.write.bind(context.provider)
    context.provider.write = async (request) => {
      writeCount += 1
      return write(request)
    }
    context.provider.status = async () => ({ status: 'unknown' })
    const prepared = await prepareApproved(context)
    await expect(context.service.commit(prepared.proposalId, later)).rejects.toMatchObject({
      code: 'MEMORY_WRITE_AMBIGUOUS',
    })
    const parked = await context.repository.get(prepared.proposalId)

    await expect(context.service.commit(prepared.proposalId, later)).rejects.toMatchObject({
      code: 'MEMORY_WRITE_AMBIGUOUS',
    })
    expect(writeCount).toBe(1)
    expect(await context.repository.get(prepared.proposalId)).toEqual(parked)

    context.provider.status = async () => {
      throw new Error('status unavailable')
    }
    await expect(context.service.commit(prepared.proposalId, later)).rejects.toMatchObject({
      code: 'MEMORY_WRITE_AMBIGUOUS',
    })
    expect(writeCount).toBe(1)
    expect(await context.repository.get(prepared.proposalId)).toEqual(parked)
  })

  test('rejects cross-scope authority, unbounded content, source documents, and conflicting dedupe', async () => {
    const { service } = harness(provider())
    await expect(
      service.propose(proposal({ scopeDigest: `sha256:${'d'.repeat(64)}` }), policy())
    ).rejects.toMatchObject({ code: 'MEMORY_SCOPE_MISMATCH' })
    await expect(
      service.propose(proposal({ workspaceId: 'wsp_01JBBCDEF0123456789ABCDEFG' }), policy())
    ).rejects.toMatchObject({ code: 'MEMORY_SCOPE_MISMATCH' })
    await expect(
      service.propose(proposal({ content: 'full transcript: private' }), policy())
    ).rejects.toMatchObject({ code: 'MEMORY_CONTENT_NOT_ALLOWED' })
    const oversized = 'x'.repeat(1_025)
    await expect(
      service.propose(
        proposal({ content: oversized, contentDigest: digest(oversized), dedupeHint: 'oversized' }),
        policy()
      )
    ).rejects.toMatchObject({ code: 'MEMORY_CONTENT_NOT_ALLOWED' })
    await service.propose(proposal(), policy())
    await expect(
      service.propose(
        proposal({
          proposalId: 'mwp_01JBBCDEF0123456789ABCDEFG',
          content: 'different',
          contentDigest: digest('different'),
        }),
        policy()
      )
    ).rejects.toMatchObject({ code: 'MEMORY_PROPOSAL_CONFLICT' })
  })
})

function harness(writer) {
  const repository = new InMemoryMemoryWriteProposalRepository()
  const interactions = new InMemoryInteractionRepository()
  return {
    repository,
    interactions,
    provider: writer,
    service: new MemoryWriteService({
      repository,
      interactionRepository: interactions,
      now: () => now,
      ...(writer ? { provider: writer } : {}),
    }),
  }
}

function provider(
  behavior = 'success',
  capabilities = { writeCommit: true, idempotentStatus: true }
) {
  return new FakeMemoryProviderWriter(
    providerId,
    connectionId,
    workspaceId,
    scopeDigest,
    capabilities,
    behavior
  )
}

async function prepareApproved(context, overrides = {}) {
  const proposed = await context.service.propose(
    proposal(overrides),
    policy({ mode: 'approval_required' }),
    approval()
  )
  await new InteractionService(context.interactions).respond({
    interactionId: proposed.approvalInteractionId,
    executionId: proposed.provenance.sourceExecutionId,
    attemptId: proposed.provenance.sourceAttemptId,
    responseId: 'cmd_01JABCDEF0123456789ABCDEFG',
    action: 'approve',
    respondingPrincipalId: 'principal:test:approver',
    expectedVersion: 1,
    respondedAt: later,
  })
  return context.service.applyApproval(proposed.proposalId, later)
}

function proposal(overrides = {}) {
  const content = overrides.content ?? 'Remember the release checklist preference.'
  return {
    proposalId: 'mwp_01JABCDEF0123456789ABCDEFG',
    providerId,
    connectionId,
    workspaceId,
    scopeDigest,
    memoryType: 'preference',
    content,
    retention: 'durable',
    provenance: {
      sourceExecutionId: 'exe_01JABCDEF0123456789ABCDEFG',
      sourceAttemptId: 'att_01JABCDEF0123456789ABCDEFG',
      confidence: 0.9,
      importance: 0.8,
      sensitivity: 'internal',
      evidenceRefs: ['artifact://evidence/1'],
      artifactRefs: ['art_01JABCDEF0123456789ABCDEFG'],
    },
    dedupeHint: 'preference:release-checklist',
    contentDigest: digest(content),
    createdAt: now,
    ...overrides,
  }
}

function policy(overrides = {}) {
  return {
    mode: 'proposal_only',
    maximumBytes: 1_024,
    allowedSensitivities: ['internal'],
    approvalPrincipalIds: ['principal:test:approver'],
    ...overrides,
  }
}

function approval(overrides = {}) {
  return {
    interactionId: 'int_01JABCDEF0123456789ABCDEFG',
    requestedAt: now,
    expiresAt: '2026-08-25T12:10:00.000Z',
    ...overrides,
  }
}

function digest(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}
