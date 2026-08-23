import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { ApiBearerAuth, ApiServiceUnavailableResponse } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'

export const SERVICE_AUTHENTICATOR = Symbol('SERVICE_AUTHENTICATOR')

export interface ServicePrincipal {
  readonly serviceId: string
}

export interface ServiceAuthenticator {
  authenticate(request: FastifyRequest): Promise<ServicePrincipal>
}

export class DisabledServiceAuthenticator implements ServiceAuthenticator {
  async authenticate(): Promise<ServicePrincipal> {
    throw new ServiceUnavailableException({
      code: 'SERVICE_AUTH_NOT_CONFIGURED',
      message: 'Service authentication is not configured',
    })
  }
}

@Injectable()
export class ServiceAuthenticationGuard implements CanActivate {
  constructor(
    @Inject(SERVICE_AUTHENTICATOR) private readonly authenticator: ServiceAuthenticator
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    await this.authenticator.authenticate(request)
    return true
  }
}

export const RequireServiceAuthentication = () =>
  applyDecorators(
    ApiBearerAuth('service-bearer'),
    ApiServiceUnavailableResponse({ description: 'Service authentication is not configured' }),
    UseGuards(ServiceAuthenticationGuard)
  )
