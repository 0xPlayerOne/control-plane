import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { TextDecoder, TextEncoder } from 'node:util'
import { DurableExecutionAcceptanceService } from '@control-plane/control-api'
import { ControlApiFixtures } from '@control-plane/contracts'
import { CommandInboxService, InMemoryCommandAcceptanceRepository } from '@control-plane/domain'
import * as relayPackage from './index.ts'
import {
  EncryptedRelayEnvelopeSchema,
  FakeOpaqueRelay,
  HostEncryptionKeyRing,
  InMemoryRelayCommandResultRepository,
  MAX_RELAY_CIPHERTEXT_BYTES,
  RELAY_ENVELOPE_VERSION,
  RELAY_HPKE_SUITE,
  RelayCommandProcessor,
  RelayEnvelopeError,
  RelayExecutionCommandProcessor,
  RelayMetadataCommandProcessor,
  RemoteControlHostAdapter,
  assertRelayCannotDecrypt,
  canonicalRelayAssociatedData,
  decodeBase64Url,
  decryptRelayPayload,
  encryptRelayPayload,
  generateHostEncryptionKeyPair,
  loadHostEncryptionKeyPair,
  publicEncryptionKey,
  relayEnvelopeHeader,
} from './index.ts'
import { encryptRelayPayloadForTesting } from './crypto.ts'

const issuedAt = '2026-08-30T00:00:00.000Z'
const expiresAt = '2026-08-30T00:10:00.000Z'
const observedAt = new Date('2026-08-30T00:05:00.000Z')
const workspaceId = 'workspace-1'
const hostId = 'host-1'
const commandId = 'command-1'
const canary = 'relay-plaintext-canary-734d'

async function fixture(overrides = {}) {
  const key = await generateHostEncryptionKeyPair(hostId, new Date(issuedAt))
  const plaintext = new TextEncoder().encode(canary)
  const envelope = await encryptRelayPayload({
    recipient: publicEncryptionKey(key),
    workspaceId,
    commandId,
    payloadType: 'create_execution',
    payloadSchemaVersion: 1,
    issuedAt,
    expiresAt,
    plaintext,
    ...overrides,
  })
  return { key, plaintext, envelope }
}

describe('RFC 9180 encrypted relay envelope', () => {
  test('does not expose deterministic ephemeral key material through the production API', () => {
    expect('encryptRelayPayloadForTesting' in relayPackage).toBe(false)
  })

  test('matches the deterministic cross-language golden fixture', async () => {
    const golden = JSON.parse(
      await readFile(
        new URL('../fixtures/golden/rfc9180-base-x25519-aes128gcm.json', import.meta.url),
        'utf8'
      )
    )
    const malformed = JSON.parse(
      await readFile(new URL('../fixtures/malformed/envelopes.json', import.meta.url), 'utf8')
    )
    const envelope = await encryptRelayPayloadForTesting(
      {
        recipient: publicEncryptionKey(golden.recipient),
        workspaceId: golden.envelope.workspaceId,
        commandId: golden.envelope.commandId,
        payloadType: golden.envelope.payloadType,
        payloadSchemaVersion: golden.envelope.payloadSchemaVersion,
        issuedAt: golden.envelope.issuedAt,
        expiresAt: golden.envelope.expiresAt,
        plaintext: new TextEncoder().encode(golden.plaintext),
      },
      decodeBase64Url(golden.testingEphemeralKeyMaterial)
    )
    expect(envelope).toEqual(golden.envelope)
    expect(
      new TextDecoder().decode(canonicalRelayAssociatedData(relayEnvelopeHeader(envelope)))
    ).toBe(golden.associatedData)
    await expect(
      decryptRelayPayload({
        envelope,
        recipient: golden.recipient,
        expectedWorkspaceId: golden.envelope.workspaceId,
        expectedHostId: golden.envelope.hostId,
        now: observedAt,
      })
    ).resolves.toEqual(new TextEncoder().encode(golden.plaintext))
    for (const invalid of malformed) {
      expect(
        EncryptedRelayEnvelopeSchema.safeParse({ ...golden.envelope, ...invalid.patch }).success,
        invalid.name
      ).toBe(false)
    }
  })

  test('round-trips the pinned X25519/HKDF-SHA256/AES-128-GCM suite', async () => {
    const { key, plaintext, envelope } = await fixture()
    expect(envelope).toMatchObject({
      envelopeVersion: RELAY_ENVELOPE_VERSION,
      suite: RELAY_HPKE_SUITE,
      keyId: key.keyId,
      workspaceId,
      hostId,
      commandId,
    })
    await expect(
      decryptRelayPayload({
        envelope,
        recipient: key,
        expectedWorkspaceId: workspaceId,
        expectedHostId: hostId,
        now: observedAt,
      })
    ).resolves.toEqual(plaintext)
  })

  test('binds every routing and schema field as associated data', async () => {
    const { key, envelope } = await fixture()
    const mutations = [
      { envelopeVersion: 2 },
      { suite: 'DHKEM_P256_HKDF_SHA256_HKDF_SHA256_AES_128_GCM' },
      { keyId: `hpk_${'f'.repeat(32)}` },
      { workspaceId: 'workspace-2' },
      { hostId: 'host-2' },
      { commandId: 'command-2' },
      { payloadType: 'submit_input' },
      { payloadSchemaVersion: 2 },
      { issuedAt: '2026-08-30T00:00:01.000Z' },
      { expiresAt: '2026-08-30T00:09:59.000Z' },
      { contentDigest: `sha256:${'f'.repeat(64)}` },
    ]
    for (const mutation of mutations) {
      await expect(
        decryptRelayPayload({
          envelope: { ...envelope, ...mutation },
          recipient: key,
          expectedWorkspaceId: workspaceId,
          expectedHostId: hostId,
          now: observedAt,
        })
      ).rejects.toBeInstanceOf(Error)
    }
  })

  test('fails closed for wrong recipients, expiry, oversized payloads, and downgrades', async () => {
    const { key, envelope } = await fixture()
    const wrongKey = await generateHostEncryptionKeyPair(hostId, new Date(issuedAt))
    await expect(
      decryptRelayPayload({
        envelope,
        recipient: wrongKey,
        expectedWorkspaceId: workspaceId,
        expectedHostId: hostId,
        now: observedAt,
      })
    ).rejects.toMatchObject({ code: 'RELAY_ENVELOPE_KEY_UNAVAILABLE' })
    await expect(
      decryptRelayPayload({
        envelope,
        recipient: key,
        expectedWorkspaceId: workspaceId,
        expectedHostId: hostId,
        now: new Date(expiresAt),
      })
    ).rejects.toBeInstanceOf(RelayEnvelopeError)
    await expect(
      fixture({ plaintext: new Uint8Array(MAX_RELAY_CIPHERTEXT_BYTES) })
    ).rejects.toMatchObject({ code: 'RELAY_ENVELOPE_TOO_LARGE' })
    expect(() => EncryptedRelayEnvelopeSchema.parse({ ...envelope, envelopeVersion: 0 })).toThrow()
  })

  test('encrypts a response to the client ephemeral return key', async () => {
    const clientPair = await generateHostEncryptionKeyPair(hostId, new Date(issuedAt))
    const returnKeyId = `rpk_${'a'.repeat(32)}`
    const returnPair = { ...clientPair, keyId: returnKeyId }
    const request = await fixture({
      returnKey: { keyId: returnKeyId, publicKey: clientPair.publicKey },
    })
    expect(request.envelope).toMatchObject({
      returnKeyId,
      returnPublicKey: clientPair.publicKey,
    })
    const responsePlaintext = new TextEncoder().encode('{"status":"accepted"}')
    const response = await encryptRelayPayload({
      recipient: publicEncryptionKey(returnPair),
      workspaceId,
      commandId: 'command-response-1',
      payloadType: 'execution_result',
      payloadSchemaVersion: 1,
      issuedAt,
      expiresAt,
      plaintext: responsePlaintext,
    })
    await expect(
      decryptRelayPayload({
        envelope: response,
        recipient: returnPair,
        expectedWorkspaceId: workspaceId,
        expectedHostId: hostId,
        now: observedAt,
      })
    ).resolves.toEqual(responsePlaintext)
  })
})

describe('host key lifecycle', () => {
  test('loads and validates private key material only through SecretsProvider leases', async () => {
    const key = await generateHostEncryptionKeyPair(hostId, new Date(issuedAt))
    let leasedBytes
    let closed = false
    const secrets = {
      resolve: async (reference, use) => {
        expect(reference).toEqual({ provider: 'host-secure', key: 'remote-control/host-1' })
        expect(use).toEqual({
          purpose: 'remote-control-host-decryption-key',
          workspaceId,
        })
        leasedBytes = new TextEncoder().encode(JSON.stringify(key))
        return {
          reference,
          value: leasedBytes,
          close: () => {
            closed = true
            leasedBytes.fill(0)
          },
        }
      },
      health: async () => ({ ready: true, component: 'test-secrets', version: '1' }),
      close: () => undefined,
    }
    await expect(
      loadHostEncryptionKeyPair(
        secrets,
        { provider: 'host-secure', key: 'remote-control/host-1' },
        hostId,
        workspaceId
      )
    ).resolves.toEqual(key)
    expect(closed).toBe(true)
    expect(leasedBytes.every((byte) => byte === 0)).toBe(true)

    const other = await generateHostEncryptionKeyPair(hostId, new Date(issuedAt))
    const invalidSecrets = {
      ...secrets,
      resolve: async (reference) => {
        const value = new TextEncoder().encode(
          JSON.stringify({ ...key, privateKey: other.privateKey })
        )
        return { reference, value, close: () => value.fill(0) }
      },
    }
    await expect(
      loadHostEncryptionKeyPair(
        invalidSecrets,
        { provider: 'host-secure', key: 'remote-control/host-1' },
        hostId
      )
    ).rejects.toThrow('HOST_ENCRYPTION_KEY_INVALID')
  })

  test('rotates with bounded grace and revokes immediately', async () => {
    const ring = new HostEncryptionKeyRing(hostId)
    const first = await ring.initialize(new Date(issuedAt))
    const rotatedAt = new Date('2026-08-30T00:06:00.000Z')
    const second = await ring.rotate(rotatedAt, 60_000)
    expect(second.keyId).not.toBe(first.keyId)
    expect(ring.decryptKey(first.keyId, new Date('2026-08-30T00:06:59.000Z')).keyId).toBe(
      first.keyId
    )
    expect(() => ring.decryptKey(first.keyId, new Date('2026-08-30T00:07:00.000Z'))).toThrow(
      RelayEnvelopeError
    )
    ring.revoke(second.keyId)
    expect(() => ring.active()).toThrow(RelayEnvelopeError)
    expect(() => ring.rotate(rotatedAt, 24 * 60 * 60 * 1000 + 1)).toThrow(
      'HOST_ENCRYPTION_KEY_GRACE_INVALID'
    )
  })
})

describe('durable execution acceptance bridge', () => {
  test('creates one logical CommandInbox execution for deterministic encrypted replay', async () => {
    const key = await generateHostEncryptionKeyPair(hostId, new Date(issuedAt))
    const request = ControlApiFixtures.executionAcceptance.request
    const relayWorkspaceId = request.workspaceId
    const relayCommandId = request.commandId
    const plaintext = new TextEncoder().encode(JSON.stringify(request))
    const envelope = await encryptRelayPayload({
      recipient: publicEncryptionKey(key),
      workspaceId: relayWorkspaceId,
      commandId: relayCommandId,
      payloadType: 'create_execution',
      payloadSchemaVersion: 1,
      issuedAt,
      expiresAt,
      plaintext,
    })
    const repository = new InMemoryCommandAcceptanceRepository()
    const submissions = []
    const acceptance = new DurableExecutionAcceptanceService({
      commands: new CommandInboxService({
        repository,
        executionIdFactory: () => 'exe_01JABCDEF0123456789ABCDEFG',
        executionPlanValidator: { validate: async () => true },
        now: () => '2026-08-23T12:00:01.000Z',
      }),
      dispatcher: { submit: async (input) => submissions.push(input) },
      now: () => '2026-08-23T12:00:01.000Z',
    })
    const processor = new RelayExecutionCommandProcessor({
      hostId,
      workspaceId: relayWorkspaceId,
      callerPrincipalId: request.caller.servicePrincipalId,
      keyResolver: () => key,
      acceptance,
    })

    const keys = new HostEncryptionKeyRing(hostId)
    keys.import(key, 'active')
    const relay = new FakeOpaqueRelay()
    relay.publish(envelope)
    const adapter = new RemoteControlHostAdapter({
      hostId,
      workspaceId: relayWorkspaceId,
      keys,
      relay,
      commands: processor,
      now: () => observedAt,
    })
    await adapter.start()
    const first = await adapter.poll()
    const replay = await processor.process(envelope, observedAt)

    expect(first).toEqual({ delivered: 1, accepted: 1, duplicates: 0, rejected: 0, deferred: 0 })
    expect(replay).toMatchObject({ outcome: 'duplicate', commandId: relayCommandId })
    expect(replay.result.data.executionId).toBe('exe_01JABCDEF0123456789ABCDEFG')
    expect(repository.executionCount).toBe(1)
    expect(submissions).toHaveLength(1)
    expect(relay.pull(hostId)).toEqual([])
    expect(plaintext).toEqual(new TextEncoder().encode(JSON.stringify(request)))
    adapter.stop()
  })

  test('rejects a validly encrypted request whose command scope differs from its envelope', async () => {
    const key = await generateHostEncryptionKeyPair(hostId, new Date(issuedAt))
    const request = ControlApiFixtures.executionAcceptance.request
    const relayCommandId = 'cmd_01KABCDEF0123456789ABCDEFG'
    const envelope = await encryptRelayPayload({
      recipient: publicEncryptionKey(key),
      workspaceId: request.workspaceId,
      commandId: relayCommandId,
      payloadType: 'create_execution',
      payloadSchemaVersion: 1,
      issuedAt,
      expiresAt,
      plaintext: new TextEncoder().encode(JSON.stringify(request)),
    })
    const processor = new RelayExecutionCommandProcessor({
      hostId,
      workspaceId: request.workspaceId,
      callerPrincipalId: request.caller.servicePrincipalId,
      keyResolver: () => key,
      acceptance: { accept: async () => ControlApiFixtures.executionAcceptance.response },
    })

    await expect(processor.process(envelope, observedAt)).rejects.toMatchObject({
      code: 'RELAY_COMMAND_SCOPE_MISMATCH',
    })
  })
})

describe('opaque delivery and durable command idempotency', () => {
  test('stores ciphertext-only records and redelivers until acknowledged', async () => {
    const { envelope } = await fixture()
    const relay = new FakeOpaqueRelay()
    const record = relay.publish(envelope, observedAt)
    const snapshot = relay.snapshot()
    assertRelayCannotDecrypt(snapshot, canary)
    expect(snapshot).not.toContain('privateKey')
    expect(relay.pull(hostId)).toEqual([{ ...record, attempts: 1 }])
    expect(relay.pull(hostId)[0]?.attempts).toBe(2)
    relay.acknowledge(record.deliveryId)
    expect(relay.pull(hostId)).toEqual([])
    expect(relay.publish(envelope).deliveryId).toBe(record.deliveryId)
    expect(() => relay.publish({ ...envelope, expiresAt: '2026-08-30T00:09:00.000Z' })).toThrow(
      'RELAY_COMMAND_CONFLICT'
    )
  })

  test('accepts concurrent duplicate delivery exactly once and zeroes plaintext afterward', async () => {
    const { key, envelope } = await fixture()
    const repository = new InMemoryRelayCommandResultRepository()
    let acceptCount = 0
    let observedPlaintext
    const processor = new RelayCommandProcessor(
      hostId,
      workspaceId,
      () => key,
      repository,
      async (_envelope, plaintext) => {
        acceptCount += 1
        observedPlaintext = plaintext
        await Promise.resolve()
        return { executionId: 'execution-1' }
      }
    )
    const [first, duplicate] = await Promise.all([
      processor.process(envelope, observedAt),
      processor.process(envelope, observedAt),
    ])
    expect([first.outcome, duplicate.outcome].sort()).toEqual(['accepted', 'duplicate'])
    expect(first.result).toEqual(duplicate.result)
    expect(acceptCount).toBe(1)
    expect(observedPlaintext).toEqual(new Uint8Array(canary.length))
    await expect(processor.process(envelope, observedAt)).resolves.toMatchObject({
      outcome: 'duplicate',
    })
    await expect(
      processor.process(
        {
          ...envelope,
          ciphertext: `${envelope.ciphertext.slice(0, -1)}${envelope.ciphertext.endsWith('A') ? 'B' : 'A'}`,
        },
        observedAt
      )
    ).rejects.toBeInstanceOf(RelayEnvelopeError)
  })

  test('registers and polls through an outbound-only host adapter', async () => {
    const { key, envelope } = await fixture()
    const keys = new HostEncryptionKeyRing(hostId)
    keys.import(key, 'active')
    const relay = new FakeOpaqueRelay()
    const repository = new InMemoryRelayCommandResultRepository()
    const processor = new RelayCommandProcessor(
      hostId,
      workspaceId,
      (keyId, now) => keys.decryptKey(keyId, now),
      repository,
      async () => ({ executionId: 'execution-1' })
    )
    const adapter = new RemoteControlHostAdapter({
      workspaceId,
      hostId,
      keys,
      relay,
      commands: processor,
      now: () => observedAt,
    })
    await adapter.start()
    expect(relay.registration(hostId)).toEqual(publicEncryptionKey(key))
    expect(await adapter.health()).toMatchObject({
      ready: true,
      details: { direction: 'outbound', listener: false },
    })
    relay.publish(envelope)
    await expect(adapter.poll()).resolves.toEqual({
      delivered: 1,
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      deferred: 0,
    })
    expect(relay.pull(hostId)).toEqual([])
    expect(relay.projections().map((projection) => projection.state)).toEqual([
      'received',
      'accepted',
    ])
    expect(relay.snapshot()).not.toContain(canary)
    await adapter.revoke(key.keyId)
    expect(relay.registration(hostId)).toBeUndefined()
    expect(() => keys.decryptKey(key.keyId, observedAt)).toThrow(RelayEnvelopeError)
    adapter.stop()
    expect((await adapter.health()).ready).toBe(false)
  })

  test('bounds and deduplicates authenticated metadata commands', async () => {
    let effects = 0
    const processor = new RelayMetadataCommandProcessor(hostId, workspaceId, async (command) => {
      effects += 1
      return { operation: command.operation, targetId: command.targetId }
    })
    const command = {
      schemaVersion: 1,
      workspaceId,
      hostId,
      commandId: 'metadata-command-1',
      operation: 'cancel',
      issuedAt,
      expiresAt,
      targetId: 'execution-1',
    }
    const [first, second] = await Promise.all([
      processor.process(command, observedAt),
      processor.process(command, observedAt),
    ])
    expect([first.outcome, second.outcome].sort()).toEqual(['accepted', 'duplicate'])
    expect(effects).toBe(1)
    await expect(
      processor.process({ ...command, commandId: 'metadata-expired' }, new Date(expiresAt))
    ).rejects.toThrow('RELAY_COMMAND_EXPIRED')
    await expect(
      processor.process(
        {
          ...command,
          commandId: 'metadata-future',
          issuedAt: '2026-08-30T01:00:00.000Z',
          expiresAt: '2026-08-30T02:00:00.000Z',
        },
        observedAt
      )
    ).rejects.toThrow('RELAY_COMMAND_EXPIRED')
    await expect(
      processor.process({ ...command, operation: 'approve', targetId: 'interaction-2' }, observedAt)
    ).rejects.toThrow('RELAY_COMMAND_CONFLICT')
    await expect(
      processor.process(
        { ...command, commandId: 'metadata-cross-scope', hostId: 'host-2' },
        observedAt
      )
    ).rejects.toThrow('RELAY_COMMAND_SCOPE_MISMATCH')
  })
})
