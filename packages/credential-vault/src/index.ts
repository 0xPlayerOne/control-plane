import { createHash } from 'node:crypto'
import { IdentifierSchemas } from '@control-plane/contracts'
import {
  PolicyDecisionSchema,
  PolicySnapshotReferenceSchema,
  type PolicyDecisionPoint,
  type PolicySnapshotReference,
} from '@control-plane/policy'
import { z } from 'zod'

const TimestampSchema = z.iso.datetime()
const ReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)

export const CredentialMetadataSchema = z
  .object({
    credentialId: IdentifierSchemas.credentialId,
    workspaceId: IdentifierSchemas.workspaceId,
    connectorRef: ReferenceSchema,
    provider: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z][a-z0-9.-]*$/),
    status: z.enum(['active', 'revoked', 'expired']),
    revision: z.number().int().positive(),
    createdAt: TimestampSchema,
    rotatedAt: TimestampSchema.optional(),
    expiresAt: TimestampSchema.optional(),
    revokedAt: TimestampSchema.optional(),
  })
  .strict()

export const CredentialLeaseSchema = z
  .object({
    credentialLeaseId: IdentifierSchemas.credentialLeaseId,
    credentialId: IdentifierSchemas.credentialId,
    credentialRevision: z.number().int().positive(),
    workspaceId: IdentifierSchemas.workspaceId,
    principalRef: ReferenceSchema,
    operation: ReferenceSchema,
    resourceRef: ReferenceSchema,
    capabilityRef: z.string().regex(/^lease:\/\/crl_[0-9A-HJKMNP-TV-Z]{26}\/[a-f0-9]{64}$/),
    status: z.enum(['active', 'consumed', 'expired', 'revoked']),
    policySnapshot: PolicySnapshotReferenceSchema,
    policyDecisionId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    consumedAt: TimestampSchema.optional(),
  })
  .strict()

export type CredentialMetadata = z.output<typeof CredentialMetadataSchema>
export type CredentialLease = z.output<typeof CredentialLeaseSchema>

export interface EncryptedSecretReference {
  readonly backend: 'memory' | 'aws-secrets-manager'
  readonly locator: string
  readonly version: string
  readonly keyReference: string
  readonly ciphertextDigest: `sha256:${string}`
}

export interface SecretProvider {
  store(input: {
    readonly credentialId: string
    readonly revision: number
    readonly secret: string
  }): Promise<EncryptedSecretReference>
  resolve(reference: EncryptedSecretReference): Promise<string>
  revoke(reference: EncryptedSecretReference): Promise<void>
}

interface CredentialRecord {
  metadata: CredentialMetadata
  readonly secrets: Map<number, EncryptedSecretReference>
}

interface LeaseRecord {
  lease: CredentialLease
  readonly secretReference: EncryptedSecretReference
}

export type CredentialVaultErrorCode =
  | 'CREDENTIAL_MISSING'
  | 'CREDENTIAL_EXISTS'
  | 'CREDENTIAL_REVOKED'
  | 'CREDENTIAL_EXPIRED'
  | 'LEASE_MISSING'
  | 'LEASE_CONFLICT'
  | 'LEASE_EXPIRED'
  | 'LEASE_REVOKED'
  | 'LEASE_CONSUMED'
  | 'LEASE_SCOPE_MISMATCH'
  | 'POLICY_DENIED'
  | 'SECRET_EGRESS_BLOCKED'
  | 'PROVIDER_OPERATION_FAILED'

export class CredentialVaultError extends Error {
  constructor(readonly code: CredentialVaultErrorCode) {
    super(code)
    this.name = 'CredentialVaultError'
  }
}

export interface CredentialAuditEvent {
  readonly action:
    | 'credential.created'
    | 'credential.rotated'
    | 'credential.revoked'
    | 'lease.issued'
    | 'lease.used'
    | 'lease.denied'
  readonly credentialId: string
  readonly credentialLeaseId?: string
  readonly workspaceId: string
  readonly revision: number
  readonly principalRef?: string
  readonly reasonCode?: string
  readonly at: string
}

export class CredentialVault {
  readonly #provider: SecretProvider
  readonly #decisionPoint: PolicyDecisionPoint
  readonly #now: () => string
  readonly #credentials = new Map<string, CredentialRecord>()
  readonly #leases = new Map<string, LeaseRecord>()
  readonly #audit: CredentialAuditEvent[] = []

  constructor(options: {
    readonly provider: SecretProvider
    readonly decisionPoint: PolicyDecisionPoint
    readonly now?: () => string
  }) {
    this.#provider = options.provider
    this.#decisionPoint = options.decisionPoint
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  async create(input: {
    readonly credentialId: string
    readonly workspaceId: string
    readonly connectorRef: string
    readonly provider: string
    readonly secret: string
    readonly createdAt: string
    readonly expiresAt?: string
  }): Promise<CredentialMetadata> {
    if (this.#credentials.has(input.credentialId)) fail('CREDENTIAL_EXISTS')
    const credentialId = IdentifierSchemas.credentialId.parse(input.credentialId)
    assertSecret(input.secret)
    const reference = await this.#storeSecret(credentialId, 1, input.secret)
    const metadata = CredentialMetadataSchema.parse({
      credentialId,
      workspaceId: input.workspaceId,
      connectorRef: input.connectorRef,
      provider: input.provider,
      status: 'active',
      revision: 1,
      createdAt: input.createdAt,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    })
    this.#credentials.set(credentialId, { metadata, secrets: new Map([[1, reference]]) })
    this.#record('credential.created', metadata)
    return clone(metadata)
  }

  async metadata(credentialId: string): Promise<CredentialMetadata> {
    const record = this.#credentials.get(IdentifierSchemas.credentialId.parse(credentialId))
    if (!record) fail('CREDENTIAL_MISSING')
    return clone(this.#currentMetadata(record))
  }

  async rotate(
    credentialId: string,
    secret: string,
    principalRef: string
  ): Promise<CredentialMetadata> {
    const record = this.#credential(credentialId)
    if (record.metadata.status === 'revoked') fail('CREDENTIAL_REVOKED')
    assertSecret(secret)
    const revision = record.metadata.revision + 1
    const reference = await this.#storeSecret(record.metadata.credentialId, revision, secret)
    record.secrets.set(revision, reference)
    record.metadata = CredentialMetadataSchema.parse({
      ...record.metadata,
      status: 'active',
      revision,
      rotatedAt: this.#now(),
    })
    this.#record('credential.rotated', record.metadata, undefined, undefined, principalRef)
    return clone(record.metadata)
  }

  async revoke(credentialId: string, principalRef: string): Promise<CredentialMetadata> {
    const record = this.#credential(credentialId)
    if (record.metadata.status !== 'revoked') {
      record.metadata = CredentialMetadataSchema.parse({
        ...record.metadata,
        status: 'revoked',
        revokedAt: this.#now(),
      })
      for (const reference of record.secrets.values()) await this.#provider.revoke(reference)
      for (const lease of this.#leases.values()) {
        if (lease.lease.credentialId !== credentialId || lease.lease.status !== 'active') continue
        lease.lease = CredentialLeaseSchema.parse({ ...lease.lease, status: 'revoked' })
      }
      this.#record('credential.revoked', record.metadata, undefined, undefined, principalRef)
    }
    return clone(record.metadata)
  }

  async lease(input: {
    readonly credentialLeaseId: string
    readonly credentialId: string
    readonly requestId: string
    readonly workspaceId: string
    readonly principalRef: string
    readonly operation: string
    readonly resourceRef: string
    readonly requestedAt: string
    readonly expiresAt: string
    readonly policySnapshot: PolicySnapshotReference
  }): Promise<CredentialLease> {
    const leaseId = IdentifierSchemas.credentialLeaseId.parse(input.credentialLeaseId)
    if (this.#leases.has(leaseId)) fail('LEASE_CONFLICT')
    const record = this.#credential(input.credentialId)
    const metadata = this.#currentMetadata(record)
    if (metadata.status === 'revoked') fail('CREDENTIAL_REVOKED')
    if (metadata.status === 'expired') fail('CREDENTIAL_EXPIRED')
    if (metadata.workspaceId !== input.workspaceId) fail('LEASE_SCOPE_MISMATCH')
    const ttl = Date.parse(input.expiresAt) - Date.parse(input.requestedAt)
    if (ttl <= 0 || ttl > 300_000 || Date.parse(input.expiresAt) <= Date.parse(this.#now())) {
      fail('LEASE_EXPIRED')
    }
    if (metadata.expiresAt && Date.parse(input.expiresAt) > Date.parse(metadata.expiresAt)) {
      fail('LEASE_EXPIRED')
    }
    let decision: z.output<typeof PolicyDecisionSchema>
    try {
      decision = PolicyDecisionSchema.parse(
        await this.#decisionPoint.authorize({
          requestId: IdentifierSchemas.requestId.parse(input.requestId),
          principal: {
            type: 'service',
            id: input.principalRef,
            workspaceId: metadata.workspaceId,
          },
          action: 'credential:lease',
          resource: {
            type: 'credential',
            id: metadata.credentialId,
            workspaceId: metadata.workspaceId,
            attributes: {
              connectorRef: metadata.connectorRef,
              provider: metadata.provider,
              revision: metadata.revision,
              operation: input.operation,
              resourceRef: input.resourceRef,
            },
          },
          context: { workspaceId: metadata.workspaceId, requestedAt: input.requestedAt },
          policySnapshot: input.policySnapshot,
        })
      )
    } catch {
      this.#record('lease.denied', metadata, leaseId, 'POLICY_EVALUATOR_FAILED')
      fail('POLICY_DENIED')
    }
    if (decision.effect !== 'allow') {
      this.#record('lease.denied', metadata, leaseId, decision.reasonCode)
      fail('POLICY_DENIED')
    }
    const secretReference = record.secrets.get(metadata.revision)
    if (!secretReference) fail('CREDENTIAL_MISSING')
    const lease = CredentialLeaseSchema.parse({
      credentialLeaseId: leaseId,
      credentialId: metadata.credentialId,
      credentialRevision: metadata.revision,
      workspaceId: metadata.workspaceId,
      principalRef: input.principalRef,
      operation: input.operation,
      resourceRef: input.resourceRef,
      capabilityRef: `lease://${leaseId}/${hash({ leaseId, decisionId: decision.decisionId, expiresAt: input.expiresAt })}`,
      status: 'active',
      policySnapshot: decision.policySnapshot,
      policyDecisionId: decision.decisionId,
      issuedAt: input.requestedAt,
      expiresAt: input.expiresAt,
    })
    this.#leases.set(lease.capabilityRef, { lease, secretReference })
    this.#record('lease.issued', metadata, leaseId)
    return clone(lease)
  }

  async use<Result>(
    capabilityRef: string,
    scope: {
      readonly workspaceId: string
      readonly operation: string
      readonly resourceRef: string
    },
    operation: (secret: string) => Result | Promise<Result>
  ): Promise<Result> {
    const record = this.#leases.get(capabilityRef)
    if (!record) fail('LEASE_MISSING')
    const { lease } = record
    if (lease.status === 'revoked') fail('LEASE_REVOKED')
    if (lease.status === 'consumed') fail('LEASE_CONSUMED')
    if (lease.status === 'expired' || Date.parse(lease.expiresAt) <= Date.parse(this.#now())) {
      record.lease = CredentialLeaseSchema.parse({ ...lease, status: 'expired' })
      fail('LEASE_EXPIRED')
    }
    const credential = this.#credential(lease.credentialId)
    if (credential.metadata.status === 'revoked') fail('CREDENTIAL_REVOKED')
    if (
      lease.workspaceId !== scope.workspaceId ||
      lease.operation !== scope.operation ||
      lease.resourceRef !== scope.resourceRef
    ) {
      fail('LEASE_SCOPE_MISMATCH')
    }
    record.lease = CredentialLeaseSchema.parse({
      ...lease,
      status: 'consumed',
      consumedAt: this.#now(),
    })
    let secret: string
    try {
      secret = await this.#provider.resolve(record.secretReference)
    } catch {
      fail('PROVIDER_OPERATION_FAILED')
    }
    try {
      const result = await operation(secret)
      if (containsSecret(result, secret)) fail('SECRET_EGRESS_BLOCKED')
      this.#record('lease.used', credential.metadata, lease.credentialLeaseId)
      return result
    } catch (error) {
      if (error instanceof CredentialVaultError) throw error
      fail('PROVIDER_OPERATION_FAILED')
    }
  }

  async audit(): Promise<readonly CredentialAuditEvent[]> {
    return clone(this.#audit)
  }

  #credential(credentialId: string): CredentialRecord {
    const record = this.#credentials.get(IdentifierSchemas.credentialId.parse(credentialId))
    if (!record) fail('CREDENTIAL_MISSING')
    return record
  }

  #currentMetadata(record: CredentialRecord): CredentialMetadata {
    if (
      record.metadata.status === 'active' &&
      record.metadata.expiresAt &&
      Date.parse(record.metadata.expiresAt) <= Date.parse(this.#now())
    ) {
      record.metadata = CredentialMetadataSchema.parse({ ...record.metadata, status: 'expired' })
    }
    return record.metadata
  }

  async #storeSecret(credentialId: string, revision: number, secret: string) {
    try {
      return await this.#provider.store({ credentialId, revision, secret })
    } catch {
      fail('PROVIDER_OPERATION_FAILED')
    }
  }

  #record(
    action: CredentialAuditEvent['action'],
    metadata: CredentialMetadata,
    credentialLeaseId?: string,
    reasonCode?: string,
    principalRef?: string
  ): void {
    this.#audit.push({
      action,
      credentialId: metadata.credentialId,
      ...(credentialLeaseId === undefined ? {} : { credentialLeaseId }),
      workspaceId: metadata.workspaceId,
      revision: metadata.revision,
      ...(principalRef === undefined ? {} : { principalRef }),
      ...(reasonCode === undefined ? {} : { reasonCode }),
      at: this.#now(),
    })
  }
}

export class InMemorySecretProvider implements SecretProvider {
  readonly #secrets = new Map<string, string>()
  readonly #revoked = new Set<string>()
  resolveCount = 0

  async store(input: { credentialId: string; revision: number; secret: string }) {
    const locator = `memory://${input.credentialId}/${input.revision}`
    this.#secrets.set(locator, input.secret)
    return {
      backend: 'memory' as const,
      locator,
      version: String(input.revision),
      keyReference: 'memory://test-kms',
      ciphertextDigest: `sha256:${hash(input.secret)}` as const,
    }
  }

  async resolve(reference: EncryptedSecretReference): Promise<string> {
    this.resolveCount += 1
    if (this.#revoked.has(reference.locator)) throw new Error('SECRET_REVOKED')
    const secret = this.#secrets.get(reference.locator)
    if (!secret) throw new Error('SECRET_MISSING')
    return secret
  }

  async revoke(reference: EncryptedSecretReference): Promise<void> {
    this.#revoked.add(reference.locator)
  }

  async references(): Promise<readonly string[]> {
    return [...this.#secrets.keys()]
  }
}

export interface AwsSecretsManagerClientPort {
  putSecretValue(input: {
    readonly secretId: string
    readonly secretString: string
    readonly kmsKeyRef: string
    readonly clientRequestToken: string
  }): Promise<{ readonly versionId: string }>
  getSecretValue(input: {
    readonly secretId: string
    readonly versionId: string
  }): Promise<{ readonly secretString?: string }>
  deleteSecretVersion?(input: {
    readonly secretId: string
    readonly versionId: string
  }): Promise<void>
}

export class AwsSecretsManagerProvider implements SecretProvider {
  readonly #client: AwsSecretsManagerClientPort
  readonly #kmsKeyRef: string
  readonly #secretPrefix: string

  constructor(options: {
    readonly client: AwsSecretsManagerClientPort
    readonly kmsKeyRef: string
    readonly secretPrefix: string
  }) {
    this.#client = options.client
    this.#kmsKeyRef = options.kmsKeyRef
    this.#secretPrefix = options.secretPrefix.replace(/\/$/, '')
  }

  async store(input: { credentialId: string; revision: number; secret: string }) {
    const secretId = `${this.#secretPrefix}/${input.credentialId}`
    const token = hash({ credentialId: input.credentialId, revision: input.revision })
    const stored = await this.#client.putSecretValue({
      secretId,
      secretString: input.secret,
      kmsKeyRef: this.#kmsKeyRef,
      clientRequestToken: token,
    })
    return {
      backend: 'aws-secrets-manager' as const,
      locator: secretId,
      version: stored.versionId,
      keyReference: this.#kmsKeyRef,
      ciphertextDigest: `sha256:${hash(input.secret)}` as const,
    }
  }

  async resolve(reference: EncryptedSecretReference): Promise<string> {
    const result = await this.#client.getSecretValue({
      secretId: reference.locator,
      versionId: reference.version,
    })
    if (!result.secretString) throw new Error('SECRET_MISSING')
    return result.secretString
  }

  async revoke(reference: EncryptedSecretReference): Promise<void> {
    await this.#client.deleteSecretVersion?.({
      secretId: reference.locator,
      versionId: reference.version,
    })
  }
}

function assertSecret(secret: string): void {
  if (secret.length < 8 || secret.length > 65_536) throw new Error('INVALID_SECRET')
}

const sensitiveKey =
  /^(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|refresh[_-]?token|secret|token)$/i

function containsSecret(value: unknown, secret: string): boolean {
  if (typeof value === 'string') return value.includes(secret)
  if (Array.isArray(value)) return value.some((entry) => containsSecret(entry, secret))
  if (value === null || typeof value !== 'object') return false
  return Object.entries(value).some(
    ([key, entry]) => sensitiveKey.test(key) || containsSecret(entry, secret)
  )
}

function hash(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  return createHash('sha256').update(serialized).digest('hex')
}

function clone<Value>(value: Value): Value {
  return structuredClone(value)
}

function fail(code: CredentialVaultErrorCode): never {
  throw new CredentialVaultError(code)
}

export const packageName = 'credential-vault'
