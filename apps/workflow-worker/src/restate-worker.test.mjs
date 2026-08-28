import { describe, expect, test } from 'bun:test'
import { createRestateEndpointOptions } from './restate-worker.ts'

describe('Restate endpoint security', () => {
  test('passes the configured request identity key to the SDK endpoint', () => {
    const requestIdentityPublicKey = 'publickeyv1_w7YHemBctH5Ck2nQRQ47iBBqhNHy4FV7t2Usbye2A6f'
    const options = createRestateEndpointOptions({ requestIdentityPublicKey })

    expect(options.identityKeys).toEqual([requestIdentityPublicKey])
    expect(options.bidirectional).toBe(false)
    expect(options.services).toHaveLength(1)
  })
})
