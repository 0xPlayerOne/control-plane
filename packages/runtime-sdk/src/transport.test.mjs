import { describe, expect, test } from 'bun:test'
import { DirectLocalRuntimeTransport, RemoteRuntimeGatewayTransport } from './transport.ts'

const handle = {
  adapterExecutionId: 'runtime-execution-1',
  executionId: 'exe_01HZZZZZZZZZZZZZZZZZZZZZZZ',
  attemptId: 'att_01HZZZZZZZZZZZZZZZZZZZZZZZ',
  startedAt: '2026-08-29T00:00:00.000Z',
}

function recordingDriver() {
  const calls = []
  const status = { state: 'running', observedAt: '2026-08-29T00:00:01.000Z' }
  return {
    calls,
    driver: {
      inspect: async (requirements) => {
        calls.push(['inspect', requirements])
        return {
          adapterVersion: '1.0.0',
          runtimeVersion: '1.0.0',
          protocolVersion: '1.0.0',
          health: 'healthy',
          capabilities: [],
          limitations: [],
          observedAt: '2026-08-29T00:00:00.000Z',
        }
      },
      start: async (request) => {
        calls.push(['start', request])
        return handle
      },
      progress: (value, options) => ({
        async *[Symbol.asyncIterator]() {
          calls.push(['progress', value, options])
          yield* []
        },
      }),
      submitInput: async (value, request) => {
        calls.push(['submitInput', value, request])
        return status
      },
      submitApproval: async (value, request) => {
        calls.push(['submitApproval', value, request])
        return status
      },
      cancel: async (value, request) => {
        calls.push(['cancel', value, request])
        return status
      },
      status: async (value) => {
        calls.push(['status', value])
        return status
      },
      reconcile: async (value) => {
        calls.push(['reconcile', value])
        return status
      },
      session: async (operation) => {
        calls.push(['session', operation])
        return { operation: operation.operation, state: 'completed' }
      },
      cleanup: async (value) => {
        calls.push(['cleanup', value])
      },
    },
  }
}

describe('RuntimeTransport', () => {
  test('direct-local delegates semantic operations without serialization', async () => {
    const { calls, driver } = recordingDriver()
    const transport = new DirectLocalRuntimeTransport(driver)
    const request = { semantic: 'same-object-reference' }

    expect(transport.kind).toBe('direct-local')
    expect(await transport.start(request)).toBe(handle)
    expect(calls).toEqual([['start', request]])
    expect(calls[0][1]).toBe(request)
  })

  test('remote-gateway preserves the same RuntimeAdapter surface', async () => {
    const { calls, driver } = recordingDriver()
    const transport = new RemoteRuntimeGatewayTransport(driver)

    expect(transport.kind).toBe('remote-gateway')
    expect(await transport.status(handle)).toEqual({
      state: 'running',
      observedAt: '2026-08-29T00:00:01.000Z',
    })
    expect(calls).toEqual([['status', handle]])
  })
})
