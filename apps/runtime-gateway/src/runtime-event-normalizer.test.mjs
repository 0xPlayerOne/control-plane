import { describe, expect, test } from 'bun:test'
import { golden } from '@control-plane/runtime-gateway-protocol/fixtures'
import { DefaultRuntimeAdapterEventNormalizer } from './runtime-event-ingestion.js'

const context = {
  command: { commandEnvelope: golden.command },
  attempt: { attemptId: golden.command.attemptId },
  execution: {},
}

describe('default Runtime Gateway event normalization', () => {
  test('normalizes bounded progress without trusting a native handle selector', async () => {
    const normalizer = new DefaultRuntimeAdapterEventNormalizer()

    expect(await normalizer.normalizeProgress({ ...context, frame: golden.progress })).toEqual({
      handleId: `${golden.command.driver.family}:${golden.command.attemptId}`,
      sequence: golden.progress.eventSequence,
      occurredAt: golden.progress.sentAt,
      type: 'output',
      data: golden.progress.event.data,
    })
  })

  test('requires an Artifact-backed success before declaring execution terminal', async () => {
    const normalizer = new DefaultRuntimeAdapterEventNormalizer()
    expect(await normalizer.normalizeResult({ ...context, frame: golden.result })).toBeUndefined()
    const artifact = {
      artifactId: 'art_01JABCDEF0123456789ABCDEFG',
      digest: `sha256:${'a'.repeat(64)}`,
      mediaType: 'application/json',
      sizeBytes: 10,
    }

    expect(
      await normalizer.normalizeResult({
        ...context,
        frame: { ...golden.result, result: { artifact } },
      })
    ).toEqual({
      state: 'completed',
      resultReference: artifact.artifactId,
      payload: {
        status: 'succeeded',
        artifact: {
          digest: artifact.digest,
          mediaType: artifact.mediaType,
          sizeBytes: artifact.sizeBytes,
        },
      },
    })
  })

  test('normalizes bounded result and error failures without retaining messages', async () => {
    const normalizer = new DefaultRuntimeAdapterEventNormalizer()
    const failed = {
      ...golden.result,
      status: 'failed',
      result: {
        data: {
          error: {
            code: 'RUNTIME_UNAVAILABLE',
            message: 'sensitive native diagnostic',
            retryable: true,
          },
        },
      },
    }

    expect(await normalizer.normalizeResult({ ...context, frame: failed })).toEqual({
      state: 'failed',
      failure: { classification: 'runtime_error', code: 'RUNTIME_UNAVAILABLE' },
      payload: { status: 'failed', code: 'RUNTIME_UNAVAILABLE', retryable: true },
    })
    expect(await normalizer.normalizeError({ ...context, frame: golden.error })).toEqual({
      state: 'failed',
      failure: { classification: 'runtime_error', code: golden.error.code },
      payload: { code: golden.error.code, retryable: golden.error.retryable },
    })
  })
})
