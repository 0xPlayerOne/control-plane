import {
  generateHostEncryptionKeyPair,
  publicEncryptionKey,
  RelayEnvelopeError,
  type HostEncryptionKeyPair,
  type HostEncryptionPublicKey,
} from './crypto.js'
import { MAX_RELAY_ENVELOPE_LIFETIME_MS } from './protocol.js'

interface ManagedHostKey {
  readonly key: HostEncryptionKeyPair
  status: 'active' | 'retired' | 'revoked'
  decryptUntil?: number
}

export class HostEncryptionKeyRing {
  readonly hostId: string
  readonly #keys = new Map<string, ManagedHostKey>()
  #activeKeyId: string | undefined

  constructor(hostId: string) {
    this.hostId = hostId
  }

  async initialize(now: Date = new Date()): Promise<HostEncryptionPublicKey> {
    if (this.#activeKeyId !== undefined) throw new Error('HOST_ENCRYPTION_KEY_ALREADY_ACTIVE')
    return this.#activate(await generateHostEncryptionKeyPair(this.hostId, now))
  }

  async rotate(
    now: Date = new Date(),
    graceMs: number = MAX_RELAY_ENVELOPE_LIFETIME_MS
  ): Promise<HostEncryptionPublicKey> {
    if (graceMs < 0 || graceMs > MAX_RELAY_ENVELOPE_LIFETIME_MS) {
      throw new Error('HOST_ENCRYPTION_KEY_GRACE_INVALID')
    }
    if (this.#activeKeyId !== undefined) {
      const current = this.#keys.get(this.#activeKeyId)
      if (current !== undefined) {
        current.status = 'retired'
        current.decryptUntil = now.getTime() + graceMs
      }
    }
    return this.#activate(await generateHostEncryptionKeyPair(this.hostId, now))
  }

  revoke(keyId: string): void {
    const managed = this.#keys.get(keyId)
    if (managed === undefined) return
    managed.status = 'revoked'
    delete managed.decryptUntil
    if (this.#activeKeyId === keyId) this.#activeKeyId = undefined
  }

  active(): HostEncryptionPublicKey {
    if (this.#activeKeyId === undefined) {
      throw new RelayEnvelopeError('RELAY_ENVELOPE_KEY_UNAVAILABLE')
    }
    const managed = this.#keys.get(this.#activeKeyId)
    if (managed === undefined || managed.status !== 'active') {
      throw new RelayEnvelopeError('RELAY_ENVELOPE_KEY_UNAVAILABLE')
    }
    return publicEncryptionKey(managed.key)
  }

  decryptKey(keyId: string, now: Date = new Date()): HostEncryptionKeyPair {
    const managed = this.#keys.get(keyId)
    if (managed === undefined || managed.status === 'revoked') {
      throw new RelayEnvelopeError('RELAY_ENVELOPE_KEY_UNAVAILABLE')
    }
    if (
      managed.status === 'retired' &&
      (managed.decryptUntil === undefined || managed.decryptUntil <= now.getTime())
    ) {
      throw new RelayEnvelopeError('RELAY_ENVELOPE_KEY_UNAVAILABLE')
    }
    return managed.key
  }

  import(
    key: HostEncryptionKeyPair,
    status: 'active' | 'retired',
    decryptUntil?: Date,
    now: Date = new Date()
  ): void {
    if (key.hostId !== this.hostId || this.#keys.has(key.keyId)) {
      throw new Error('HOST_ENCRYPTION_KEY_IMPORT_INVALID')
    }
    if (status === 'active' && this.#activeKeyId !== undefined) {
      throw new Error('HOST_ENCRYPTION_KEY_ALREADY_ACTIVE')
    }
    if (
      status === 'retired' &&
      (decryptUntil === undefined ||
        !Number.isFinite(decryptUntil.getTime()) ||
        decryptUntil.getTime() <= now.getTime() ||
        decryptUntil.getTime() - now.getTime() > MAX_RELAY_ENVELOPE_LIFETIME_MS)
    ) {
      throw new Error('HOST_ENCRYPTION_KEY_IMPORT_INVALID')
    }
    this.#keys.set(key.keyId, {
      key,
      status,
      ...(decryptUntil === undefined ? {} : { decryptUntil: decryptUntil.getTime() }),
    })
    if (status === 'active') this.#activeKeyId = key.keyId
  }

  #activate(key: HostEncryptionKeyPair): HostEncryptionPublicKey {
    this.#keys.set(key.keyId, { key, status: 'active' })
    this.#activeKeyId = key.keyId
    return publicEncryptionKey(key)
  }
}
