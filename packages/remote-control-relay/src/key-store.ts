import type { SecretReference, SecretsProvider } from '@control-plane/deployment'
import { z } from 'zod'
import { validateHostEncryptionKeyPair, type HostEncryptionKeyPair } from './crypto.js'

const HostEncryptionKeyPairSchema = z
  .object({
    keyId: z.string().regex(/^hpk_[a-f0-9]{32}$/),
    hostId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    publicKey: z
      .string()
      .length(43)
      .regex(/^[A-Za-z0-9_-]+$/),
    privateKey: z
      .string()
      .length(43)
      .regex(/^[A-Za-z0-9_-]+$/),
    fingerprint: z.custom<`sha256:${string}`>(
      (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value)
    ),
    createdAt: z.iso.datetime(),
  })
  .strict()

export async function loadHostEncryptionKeyPair(
  secrets: SecretsProvider,
  reference: SecretReference,
  expectedHostId: string,
  workspaceId?: string
): Promise<HostEncryptionKeyPair> {
  const lease = await secrets.resolve(reference, {
    purpose: 'remote-control-host-decryption-key',
    ...(workspaceId === undefined ? {} : { workspaceId }),
  })
  try {
    const key = HostEncryptionKeyPairSchema.parse(JSON.parse(new TextDecoder().decode(lease.value)))
    if (key.hostId !== expectedHostId || !(await validateHostEncryptionKeyPair(key))) {
      throw new Error('HOST_ENCRYPTION_KEY_INVALID')
    }
    return key
  } catch {
    throw new Error('HOST_ENCRYPTION_KEY_INVALID')
  } finally {
    lease.close()
  }
}
