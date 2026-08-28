import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { TextEncoder } from 'node:util'
import { ObjectStoreError } from '@control-plane/object-store'
import { createExecutionPlanTestFixture } from '@control-plane/execution-plan/testing'
import {
  CLOUD_CERTIFICATION_OUTPUT_CONTRACT,
  CloudCertificationRuntime,
} from './cloud-certification-runtime.ts'

const executionId = 'exe_01ARZ3NDEKTSV4RRFFQ69G5FAV'
const attemptId = 'att_01ARZ3NDEKTSV4RRFFQ69G5FAV'

describe('Cloud certification runtime', () => {
  test('writes, verifies, and replays one deterministic R2 result artifact', async () => {
    const store = new MemoryObjectStore()
    const runtime = new CloudCertificationRuntime(store)
    const input = dispatchInput()

    const first = await runtime.dispatch(input)
    const replay = await runtime.dispatch(input)

    expect(first).toEqual({
      outcome: 'completed',
      resultReference: 'art_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    })
    expect(replay).toEqual(first)
    expect(store.puts).toBe(1)
    expect(store.gets).toBe(3)
    expect(store.heads).toBe(2)
    expect(store.keys()).toEqual([
      `m9/certification/executions/${executionId}/${input.executionPlan.contentDigest.slice(7)}.json`,
    ])
  })

  test('rejects a retained object with conflicting execution content', async () => {
    const store = new MemoryObjectStore()
    const runtime = new CloudCertificationRuntime(store)
    await runtime.dispatch(dispatchInput())
    store.replaceOnlyBody(new TextEncoder().encode('{"tampered":true}'))

    await expect(runtime.dispatch(dispatchInput())).rejects.toThrow(
      'CLOUD_CERTIFICATION_ARTIFACT_CONFLICT'
    )
    expect(store.puts).toBe(1)
  })

  test('rejects mismatched attempt and workflow effect identities before R2 access', async () => {
    const store = new MemoryObjectStore()
    const runtime = new CloudCertificationRuntime(store)

    await expect(
      runtime.dispatch({ ...dispatchInput(), attemptId: 'att_01JABCDEF0123456789ABCDEFG' })
    ).rejects.toThrow('CLOUD_CERTIFICATION_IDENTITY_MISMATCH')
    await expect(
      runtime.dispatch({ ...dispatchInput(), effectKey: 'untrusted-effect' })
    ).rejects.toThrow('CLOUD_CERTIFICATION_IDENTITY_MISMATCH')
    expect(store.gets).toBe(0)
  })

  test('rejects an ordinary execution plan before R2 access', async () => {
    const store = new MemoryObjectStore()
    const runtime = new CloudCertificationRuntime(store)
    const input = dispatchInput()
    input.executionPlan.outputContract.contractRef = 'contract://execution-result/v1'

    await expect(runtime.dispatch(input)).rejects.toThrow('CLOUD_CERTIFICATION_PLAN_NOT_AUTHORIZED')
    expect(store.gets).toBe(0)
  })

  test('does not support interaction or delete terminal certification evidence during cleanup', async () => {
    const store = new MemoryObjectStore()
    const runtime = new CloudCertificationRuntime(store)

    await expect(runtime.applyInteraction({})).resolves.toEqual({
      outcome: 'failed',
      failureCode: 'CLOUD_CERTIFICATION_INTERACTION_UNSUPPORTED',
      retryable: false,
    })
    await runtime.cleanup({ executionId, attemptId, effectKey: 'cleanup' })
    expect(store.deletes).toBe(0)
  })
})

function dispatchInput() {
  const executionPlan = createExecutionPlanTestFixture()
  executionPlan.outputContract.contractRef = CLOUD_CERTIFICATION_OUTPUT_CONTRACT
  return {
    executionId,
    attemptId,
    executionPlan,
    effectKey: 'wfl_01ARZ3NDEKTSV4RRFFQ69G5FAV:execution-lifecycle-v1:dispatch',
  }
}

class MemoryObjectStore {
  records = new Map()
  puts = 0
  gets = 0
  heads = 0
  deletes = 0

  async put(input) {
    this.puts += 1
    const descriptor = descriptorFor(input.key, input.body, input.contentType, input.metadata)
    this.records.set(input.key, { ...descriptor, body: input.body.slice() })
    return globalThis.structuredClone(descriptor)
  }

  async get(key) {
    this.gets += 1
    const record = this.records.get(key)
    if (!record) throw new ObjectStoreError('OBJECT_STORE_NOT_FOUND', false)
    return globalThis.structuredClone(record)
  }

  async head(key) {
    this.heads += 1
    const record = this.records.get(key)
    if (!record) throw new ObjectStoreError('OBJECT_STORE_NOT_FOUND', false)
    return globalThis.structuredClone({
      key: record.key,
      size: record.size,
      ...(record.contentType === undefined ? {} : { contentType: record.contentType }),
      sha256: record.sha256,
      metadata: record.metadata,
    })
  }

  async delete(key) {
    this.deletes += 1
    this.records.delete(key)
  }

  close() {}

  keys() {
    return [...this.records.keys()]
  }

  replaceOnlyBody(body) {
    const [key] = this.keys()
    this.records.get(key).body = body
  }
}

function descriptorFor(key, body, contentType, metadata = {}) {
  const digest = createHash('sha256').update(body).digest('hex')
  return {
    key,
    size: body.byteLength,
    ...(contentType === undefined ? {} : { contentType }),
    sha256: `sha256:${digest}`,
    metadata: { ...metadata },
  }
}
