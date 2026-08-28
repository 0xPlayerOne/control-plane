import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiServiceUnavailableResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { StructuredLogger } from '@control-plane/bootstrap'
import {
  ReadRequestEnvelopeSchema,
  ServiceAuthenticationRequestSchema,
  ServiceCredentialClaimsSchema,
  ServicePrincipalSchema,
  StateChangingCommandEnvelopeSchema,
  type ServiceCredentialClaims,
  type ServicePrincipal,
} from '@control-plane/contracts'
import type { FastifyRequest } from 'fastify'

export const SERVICE_AUTHENTICATOR = Symbol('SERVICE_AUTHENTICATOR')
const REQUIRED_SERVICE_SCOPES = Symbol('REQUIRED_SERVICE_SCOPES')
type ScopedServiceEnvelope = {
  readonly caller?: { readonly servicePrincipalId: string } | undefined
  readonly projectId?: ServiceCredentialClaims['projectIds'][number] | undefined
  readonly workspaceId: ServiceCredentialClaims['workspaceIds'][number]
}

declare module 'fastify' {
  interface FastifyRequest {
    servicePrincipal?: ServicePrincipal
  }
}

export interface ServiceCredentialVerifier {
  verify(credential: string): Promise<unknown>
}

export interface ServiceCredentialRevocationChecker {
  isRevoked(credentialId: string): Promise<boolean>
}

export interface TrustedEd25519ServiceKey {
  readonly keyId: string
  readonly publicKey: string
}

export class Ed25519ServiceCredentialVerifier implements ServiceCredentialVerifier {
  readonly #keys: ReadonlyMap<string, KeyObject>

  constructor(keys: readonly TrustedEd25519ServiceKey[]) {
    if (keys.length === 0 || keys.length > 32) verificationFailed()
    const entries = keys.map((key) => {
      if (
        !/^[A-Za-z0-9._:-]{1,128}$/.test(key.keyId) ||
        !/^[A-Za-z0-9_-]{43}$/.test(key.publicKey) ||
        Buffer.from(key.publicKey, 'base64url').length !== 32
      ) {
        verificationFailed()
      }
      return [
        key.keyId,
        createPublicKey({
          key: { crv: 'Ed25519', kty: 'OKP', x: key.publicKey },
          format: 'jwk',
        }),
      ] as const
    })
    if (new Set(entries.map(([keyId]) => keyId)).size !== entries.length) verificationFailed()
    this.#keys = new Map(entries)
  }

  async verify(credential: string): Promise<unknown> {
    if (credential.length < 32 || credential.length > 131_072) verificationFailed()
    const segments = credential.split('.')
    if (segments.length !== 3) verificationFailed()
    const [encodedHeader, encodedPayload, encodedSignature] = segments
    if (!encodedHeader || !encodedPayload || !encodedSignature) verificationFailed()
    const header = parseJsonSegment(encodedHeader)
    const keyId = Reflect.get(header, 'kid')
    if (
      Reflect.get(header, 'alg') !== 'EdDSA' ||
      Reflect.get(header, 'typ') !== 'JWT' ||
      typeof keyId !== 'string'
    ) {
      verificationFailed()
    }
    const key = this.#keys.get(keyId)
    if (!key) verificationFailed()
    const signature = decodeBase64Url(encodedSignature)
    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`)
    if (signature.length !== 64 || !verify(null, signingInput, key, signature)) {
      verificationFailed()
    }
    const claims = parseJsonSegment(encodedPayload)
    if (Reflect.get(claims, 'keyId') !== keyId) verificationFailed()
    return claims
  }
}

export class ConfiguredCredentialRevocationChecker implements ServiceCredentialRevocationChecker {
  readonly #revoked: ReadonlySet<string>

  constructor(credentialIds: readonly string[]) {
    this.#revoked = new Set(credentialIds)
  }

  async isRevoked(credentialId: string): Promise<boolean> {
    return this.#revoked.has(credentialId)
  }
}

export interface ServiceAuthenticator {
  authenticate(
    request: FastifyRequest,
    requiredScopes: readonly string[]
  ): Promise<ServicePrincipal>
}

export interface PolicyServiceAuthenticatorOptions {
  readonly audience: string
  readonly clockSkewMs?: number
  readonly issuer: string
  readonly logger: StructuredLogger
  readonly now?: () => Date
  readonly revocationChecker: ServiceCredentialRevocationChecker
  readonly verifier: ServiceCredentialVerifier
}

export class DisabledServiceAuthenticator implements ServiceAuthenticator {
  async authenticate(): Promise<ServicePrincipal> {
    throw new ServiceUnavailableException({
      code: 'SERVICE_AUTH_NOT_CONFIGURED',
      message: 'Service authentication is not configured',
    })
  }
}

function parseJsonSegment(segment: string): object {
  const bytes = decodeBase64Url(segment)
  if (bytes.length === 0 || bytes.length > 65_536) verificationFailed()
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) verificationFailed()
    return parsed
  } catch {
    verificationFailed()
  }
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) verificationFailed()
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.toString('base64url') !== value) verificationFailed()
  return decoded
}

function verificationFailed(): never {
  throw new Error('SERVICE_CREDENTIAL_VERIFICATION_FAILED')
}

export class PolicyServiceAuthenticator implements ServiceAuthenticator {
  readonly #audience: string
  readonly #clockSkewMs: number
  readonly #issuer: string
  readonly #logger: StructuredLogger
  readonly #now: () => Date
  readonly #revocationChecker: ServiceCredentialRevocationChecker
  readonly #verifier: ServiceCredentialVerifier

  constructor(options: PolicyServiceAuthenticatorOptions) {
    this.#audience = options.audience
    this.#clockSkewMs = options.clockSkewMs ?? 30_000
    this.#issuer = options.issuer
    this.#logger = options.logger
    this.#now = options.now ?? (() => new Date())
    this.#revocationChecker = options.revocationChecker
    this.#verifier = options.verifier
  }

  async authenticate(
    request: FastifyRequest,
    requiredScopes: readonly string[]
  ): Promise<ServicePrincipal> {
    const credential = this.#bearerCredential(request)
    const claims = await this.#verifiedClaims(request, credential)
    this.#validateCredentialClass(request, claims)
    this.#validateAuthority(request, claims)
    this.#validateLifetime(request, claims)
    if (await this.#revocationChecker.isRevoked(claims.credentialId)) {
      this.#rejectAuthentication(request, 'SERVICE_CREDENTIAL_REVOKED', claims.principalId)
    }

    const envelope = this.#requestEnvelope(request, requiredScopes)
    this.#validateScope(request, claims, requiredScopes, envelope)
    const principal = ServicePrincipalSchema.parse({
      kind: 'agent_hq_service',
      principalId: claims.principalId,
      projectIds: claims.projectIds,
      scopes: claims.scopes,
      workspaceIds: claims.workspaceIds,
    })
    this.#logger.write({
      level: 'info',
      event: 'service_auth.succeeded',
      details: {
        principalId: principal.principalId,
        projectId: envelope.projectId,
        requestId: request.id,
        workspaceId: envelope.workspaceId,
      },
    })
    return principal
  }

  #bearerCredential(request: FastifyRequest): string {
    const authorization = request.headers.authorization
    if (authorization === undefined) {
      this.#rejectAuthentication(request, 'SERVICE_CREDENTIAL_REQUIRED')
    }
    const match = /^Bearer ([^\s]+)$/.exec(authorization)
    if (match?.[1] === undefined) {
      this.#rejectAuthentication(request, 'SERVICE_CREDENTIAL_MALFORMED')
    }
    return match[1]
  }

  async #verifiedClaims(
    request: FastifyRequest,
    credential: string
  ): Promise<ServiceCredentialClaims> {
    let untrustedClaims: unknown
    try {
      untrustedClaims = await this.#verifier.verify(credential)
    } catch {
      this.#rejectAuthentication(request, 'SERVICE_CREDENTIAL_MALFORMED')
    }
    const result = ServiceCredentialClaimsSchema.safeParse(untrustedClaims)
    if (!result.success) {
      this.#rejectAuthentication(request, 'SERVICE_CREDENTIAL_MALFORMED')
    }
    return result.data
  }

  #validateCredentialClass(request: FastifyRequest, claims: ServiceCredentialClaims): void {
    if (claims.credentialKind !== 'service') {
      this.#rejectAuthentication(request, 'SERVICE_CREDENTIAL_CLASS_REJECTED', claims.principalId)
    }
  }

  #validateAuthority(request: FastifyRequest, claims: ServiceCredentialClaims): void {
    if (claims.issuer !== this.#issuer) {
      this.#rejectAuthentication(request, 'SERVICE_CREDENTIAL_INVALID_ISSUER', claims.principalId)
    }
    if (claims.audience !== this.#audience) {
      this.#rejectAuthentication(request, 'SERVICE_CREDENTIAL_INVALID_AUDIENCE', claims.principalId)
    }
  }

  #validateLifetime(request: FastifyRequest, claims: ServiceCredentialClaims): void {
    const now = this.#now().getTime()
    if (Date.parse(claims.issuedAt) > now + this.#clockSkewMs) {
      this.#rejectAuthentication(request, 'SERVICE_CREDENTIAL_NOT_YET_VALID', claims.principalId)
    }
    if (Date.parse(claims.expiresAt) < now - this.#clockSkewMs) {
      this.#rejectAuthentication(request, 'SERVICE_CREDENTIAL_EXPIRED', claims.principalId)
    }
  }

  #requestEnvelope(request: FastifyRequest, requiredScopes: readonly string[]) {
    if (requiredScopes.length === 1 && requiredScopes[0] === 'system:authenticate') {
      const authentication = ServiceAuthenticationRequestSchema.safeParse(request.body)
      if (authentication.success) return authentication.data
    }
    const read = ReadRequestEnvelopeSchema.safeParse(request.body)
    if (read.success) return read.data
    const command = StateChangingCommandEnvelopeSchema.safeParse(request.body)
    if (command.success) return command.data
    this.#logger.write({
      level: 'warn',
      event: 'service_auth.request_rejected',
      details: { code: 'SERVICE_REQUEST_ENVELOPE_INVALID', requestId: request.id },
    })
    throw new BadRequestException({
      code: 'SERVICE_REQUEST_ENVELOPE_INVALID',
      message: 'A valid versioned service request envelope is required',
    })
  }

  #validateScope(
    request: FastifyRequest,
    claims: ServiceCredentialClaims,
    requiredScopes: readonly string[],
    envelope: ScopedServiceEnvelope
  ): void {
    const hasRequiredScopes = requiredScopes.every((scope) => claims.scopes.includes(scope))
    const hasCaller = envelope.caller?.servicePrincipalId === claims.principalId
    const hasWorkspace = claims.workspaceIds.includes(envelope.workspaceId)
    const hasProject =
      envelope.projectId === undefined || claims.projectIds.includes(envelope.projectId)
    if (!hasCaller || !hasRequiredScopes || !hasWorkspace || !hasProject) {
      this.#logger.write({
        level: 'warn',
        event: 'service_auth.failed',
        details: {
          code: 'SERVICE_CREDENTIAL_SCOPE_MISMATCH',
          principalId: claims.principalId,
          requestId: request.id,
        },
      })
      throw new ForbiddenException({
        code: 'SERVICE_CREDENTIAL_SCOPE_MISMATCH',
        message: 'Service principal is not authorized for the requested scope',
      })
    }
  }

  #rejectAuthentication(request: FastifyRequest, code: string, principalId?: string): never {
    this.#logger.write({
      level: 'warn',
      event: 'service_auth.failed',
      details: {
        code,
        ...(principalId === undefined ? {} : { principalId }),
        requestId: request.id,
      },
    })
    throw new UnauthorizedException({ code, message: 'Service credential was rejected' })
  }
}

export function createInternalServicePrincipal(input: {
  readonly principalId: string
  readonly projectIds?: readonly string[]
  readonly scopes: readonly string[]
  readonly workspaceIds?: readonly string[]
}): ServicePrincipal {
  return ServicePrincipalSchema.parse({
    kind: 'internal_service',
    principalId: input.principalId,
    projectIds: input.projectIds ?? [],
    scopes: input.scopes,
    workspaceIds: input.workspaceIds ?? [],
  })
}

@Injectable()
export class ServiceAuthenticationGuard implements CanActivate {
  constructor(
    @Inject(SERVICE_AUTHENTICATOR) private readonly authenticator: ServiceAuthenticator,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    const requiredScopes =
      this.reflector.getAllAndOverride<readonly string[]>(REQUIRED_SERVICE_SCOPES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []
    request.servicePrincipal = await this.authenticator.authenticate(request, requiredScopes)
    return true
  }
}

export const RequireServiceAuthentication = (...requiredScopes: readonly string[]) =>
  applyDecorators(
    SetMetadata(REQUIRED_SERVICE_SCOPES, requiredScopes),
    ApiBearerAuth('service-bearer'),
    ApiUnauthorizedResponse({ description: 'Service credential rejected' }),
    ApiForbiddenResponse({ description: 'Service principal scope mismatch' }),
    ApiServiceUnavailableResponse({ description: 'Service authentication is not configured' }),
    UseGuards(ServiceAuthenticationGuard)
  )
