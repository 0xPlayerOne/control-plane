import { Module, type DynamicModule } from '@nestjs/common'
import {
  createConsoleTraceAdapter,
  createOpenTelemetryMetricAdapter,
  createOpenTelemetryTraceAdapter,
  createTelemetry,
} from '@control-plane/telemetry'
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
  API_TELEMETRY,
  type ApiRuntimeBindings,
} from './http/tokens.js'
import { SystemController } from './system/system.controller.js'
import { SystemService } from './system/system.service.js'
import { RuntimeDiscoveryController } from './runtime-discovery/runtime-discovery.controller.js'
import {
  EmptyRuntimeDiscoveryRepository,
  RUNTIME_DISCOVERY_REPOSITORY,
  type RuntimeDiscoveryRepository,
} from './runtime-discovery/runtime-discovery.repository.js'
import { RuntimeDiscoveryService } from './runtime-discovery/runtime-discovery.service.js'

export interface AppModuleOptions extends ApiRuntimeBindings {
  readonly serviceAuthenticator?: ServiceAuthenticator
  readonly runtimeDiscoveryRepository?: RuntimeDiscoveryRepository
}

@Module({})
export class AppModule {}

export function createAppModule(options: AppModuleOptions): DynamicModule {
  const traceAdapter =
    options.metadata.environment === 'development'
      ? createConsoleTraceAdapter(options.logger)
      : createOpenTelemetryTraceAdapter(options.metadata.serviceName)
  const telemetry =
    options.telemetry ??
    createTelemetry({
      serviceName: options.metadata.serviceName,
      logger: options.logger,
      traceAdapter,
      metricAdapter: createOpenTelemetryMetricAdapter(options.metadata.serviceName),
    })
  return {
    module: AppModule,
    controllers: [HealthController, RuntimeDiscoveryController, SystemController],
    providers: [
      { provide: API_HEALTH, useValue: options.health },
      { provide: API_LOGGER, useValue: options.logger },
      { provide: API_METADATA, useValue: options.metadata },
      { provide: API_READINESS, useValue: options.readiness },
      { provide: API_TELEMETRY, useValue: telemetry },
      {
        provide: SERVICE_AUTHENTICATOR,
        useValue: options.serviceAuthenticator ?? new DisabledServiceAuthenticator(),
      },
      {
        provide: RUNTIME_DISCOVERY_REPOSITORY,
        useValue: options.runtimeDiscoveryRepository ?? new EmptyRuntimeDiscoveryRepository(),
      },
      RequestLoggingInterceptor,
      ServiceAuthenticationGuard,
      RuntimeDiscoveryService,
      SystemService,
    ],
  }
}
