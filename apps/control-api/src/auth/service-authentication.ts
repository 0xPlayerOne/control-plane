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
