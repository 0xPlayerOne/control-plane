import { z } from 'zod'

const CredentialKindSchema = z.enum(['connector', 'provider', 'runtime_node', 'service'])
const CredentialEnvelopeSchema = z
  .object({
    kind: CredentialKindSchema,
    audience: z.string().min(1).max(256),
    subject: z.string().min(1).max(256),
    workspaceId: z.string().min(1).max(256),
  })
  .strict()

export type CredentialKind = z.output<typeof CredentialKindSchema>
export type CredentialEnvelope = z.output<typeof CredentialEnvelopeSchema>

const credentialRules = [
  { rule: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/ },
  { rule: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { rule: 'private-key', pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { rule: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { rule: 'stripe-live-key', pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
  { rule: 'google-api-key', pattern: /\bAIza[A-Za-z0-9_-]{35}\b/ },
] as const
const placeholderPattern = /(?:example|placeholder|replace[-_ ]?me|your[-_ ]|x{8,})/i

export class SecretCanaryGuard {
  readonly #canaries: readonly string[]

  constructor(canaries: readonly string[]) {
    if (
      canaries.length === 0 ||
      canaries.some((canary) => canary.length < 16 || canary.length > 512) ||
      new Set(canaries).size !== canaries.length
    ) {
      throw new Error('INVALID_SECRET_CANARIES')
    }
    this.#canaries = [...canaries]
  }

  assertSafe(sinks: Readonly<Record<string, unknown>>): void {
    for (const [sink, value] of Object.entries(sinks)) {
      if (containsCanary(value, this.#canaries)) throw new Error(`SECRET_CANARY_LEAK:${sink}`)
    }
  }
}

export function findCredentialLeaks(
  path: string,
  contents: string
): readonly { readonly path: string; readonly rule: string }[] {
  const findings = []
  for (const line of contents.split(/\r?\n/)) {
    if (placeholderPattern.test(line)) continue
    for (const { pattern, rule } of credentialRules) {
      if (pattern.test(line)) findings.push({ path, rule })
    }
  }
  return [...new Map(findings.map((finding) => [finding.rule, finding])).values()]
}

export function assertCredentialPurpose(
  input: unknown,
  expectedKind: CredentialKind,
  expectedAudience: string
): CredentialEnvelope {
  const credential = CredentialEnvelopeSchema.parse(input)
  if (credential.kind !== expectedKind) throw new Error('CREDENTIAL_PURPOSE_MISMATCH')
  if (credential.audience !== expectedAudience) throw new Error('CREDENTIAL_AUDIENCE_MISMATCH')
  return structuredClone(credential)
}

export async function runAuthorizationIsolationMatrix(input: {
  readonly dimensions: readonly string[]
  readonly operations: readonly string[]
  readonly probe: (input: {
    readonly dimension: string
    readonly operation: string
    readonly sameScope: boolean
  }) => Promise<{ readonly allowed: boolean; readonly publicCode: string }>
}): Promise<
  readonly {
    readonly dimension: string
    readonly operation: string
    readonly sameScope: boolean
    readonly publicCode: string
    readonly passed: boolean
  }[]
> {
  if (input.dimensions.length === 0 || input.operations.length === 0) {
    throw new Error('AUTHORIZATION_MATRIX_EMPTY')
  }
  const results = []
  for (const dimension of input.dimensions) {
    for (const operation of input.operations) {
      for (const sameScope of [true, false]) {
        const outcome = await input.probe({ dimension, operation, sameScope })
        const passed = sameScope
          ? outcome.allowed
          : !outcome.allowed && outcome.publicCode === 'RESOURCE_NOT_FOUND'
        results.push({
          dimension,
          operation,
          sameScope,
          publicCode: outcome.publicCode,
          passed,
        })
        if (!passed) throw new Error(`AUTHORIZATION_ISOLATION_FAILED:${dimension}:${operation}`)
      }
    }
  }
  return results
}

function containsCanary(root: unknown, canaries: readonly string[]): boolean {
  const pending: unknown[] = [root]
  const seen = new WeakSet<object>()
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value === 'string' && canaries.some((canary) => value.includes(canary))) return true
    if (value === null || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    if (value instanceof Error) {
      pending.push(value.name, value.message, value.stack, value.cause)
      continue
    }
    if (Array.isArray(value)) pending.push(...value)
    else {
      for (const [key, nested] of Object.entries(value)) pending.push(key, nested)
    }
  }
  return false
}
