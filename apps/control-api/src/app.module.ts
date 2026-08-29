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
import { ExecutionAcceptanceController } from './executions/execution-acceptance.controller.js'
import {
  EXECUTION_ACCEPTANCE_SERVICE,
  UnavailableExecutionAcceptanceService,
  type ExecutionAcceptanceService,
} from './executions/execution-acceptance.service.js'
import { ExecutionValidationController } from './executions/execution-validation.controller.js'
import {
  EXECUTION_VALIDATION_SERVICE,
  UnavailableExecutionValidationService,
  type ExecutionValidationService,
} from './executions/execution-validation.service.js'
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
  readonly executionAcceptanceService?: ExecutionAcceptanceService
  readonly executionValidationService?: ExecutionValidationService
  readonly serviceAuthenticator?: ServiceAuthenticator
  readonly runtimeDiscoveryRepository?: RuntimeDiscoveryRepository
  readonly componentManifest?: () => Promise<unknown>
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
    controllers: [
      ExecutionAcceptanceController,
      ExecutionValidationController,
      HealthController,
      RuntimeDiscoveryController,
      SystemController,
    ],
    providers: [
      { provide: API_HEALTH, useValue: options.health },
      { provide: API_LOGGER, useValue: options.logger },
      { provide: API_METADATA, useValue: options.metadata },
      { provide: API_READINESS, useValue: options.readiness },
      { provide: API_TELEMETRY, useValue: telemetry },
      {
        provide: EXECUTION_ACCEPTANCE_SERVICE,
        useValue: options.executionAcceptanceService ?? new UnavailableExecutionAcceptanceService(),
      },
      {
        provide: EXECUTION_VALIDATION_SERVICE,
        useValue: options.executionValidationService ?? new UnavailableExecutionValidationService(),
      },
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
