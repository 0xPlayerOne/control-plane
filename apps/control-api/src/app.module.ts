import { Module, type DynamicModule } from '@nestjs/common'
import {
  DisabledServiceAuthenticator,
  SERVICE_AUTHENTICATOR,
  ServiceAuthenticationGuard,
  type ServiceAuthenticator,
} from './auth/service-authentication.js'
import { HealthController } from './health/health.controller.js'
import { RequestLoggingInterceptor } from './http/request-logging.interceptor.js'
import {
  API_HEALTH,
  API_LOGGER,
  API_METADATA,
  API_READINESS,
  type ApiRuntimeBindings,
} from './http/tokens.js'
import { SystemController } from './system/system.controller.js'
import { SystemService } from './system/system.service.js'

export interface AppModuleOptions extends ApiRuntimeBindings {
  readonly serviceAuthenticator?: ServiceAuthenticator
}

@Module({})
export class AppModule {}

export function createAppModule(options: AppModuleOptions): DynamicModule {
  return {
    module: AppModule,
    controllers: [HealthController, SystemController],
    providers: [
      { provide: API_HEALTH, useValue: options.health },
      { provide: API_LOGGER, useValue: options.logger },
      { provide: API_METADATA, useValue: options.metadata },
      { provide: API_READINESS, useValue: options.readiness },
      {
        provide: SERVICE_AUTHENTICATOR,
        useValue: options.serviceAuthenticator ?? new DisabledServiceAuthenticator(),
      },
      RequestLoggingInterceptor,
      ServiceAuthenticationGuard,
      SystemService,
    ],
  }
}
