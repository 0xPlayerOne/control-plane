import type { StructuredLogger } from '@control-plane/bootstrap'
import type { ManagedCloudConfiguration } from '@control-plane/config'
import {
  createPostgresConnection,
  PostgresCatalogRepository,
  PostgresCommandAcceptanceRepository,
  PostgresContextPackageRepository,
  PostgresExecutionPlanRepository,
  PostgresProjectStateRepository,
  type PostgresConnection,
} from '@control-plane/database'
import { CommandInboxService } from '@control-plane/domain'
import { ExecutionPlanAcceptanceValidator } from '@control-plane/execution-plan'
import {
  ConfiguredCredentialRevocationChecker,
  Ed25519ServiceCredentialVerifier,
  PolicyServiceAuthenticator,
} from './auth/service-authentication.js'
import { DurableExecutionValidationService } from './executions/execution-validation.service.js'
import {
  DurableExecutionAcceptanceService,
  RestateExecutionWorkflowDispatcher,
  createExecutionId,
} from './executions/execution-acceptance.service.js'
import { RepositoryProfileResolutionService } from './queries/profile-resolution.service.js'
import { RepositoryProjectStateResolutionService } from './queries/project-state-resolution.service.js'
import { RepositoryContextPackageResolutionService } from './queries/context-package-resolution.service.js'

const executionPlanCompilerVersion = '1.0.0'

export type PostgresConnectionFactory = typeof createPostgresConnection

export interface ManagedCloudControlApiComposition {
  readonly connection: PostgresConnection
  readonly executionAcceptanceService: DurableExecutionAcceptanceService
  readonly executionValidationService: DurableExecutionValidationService
  readonly serviceAuthenticator: PolicyServiceAuthenticator
  readonly profileResolutionService: RepositoryProfileResolutionService
  readonly projectStateResolutionService: RepositoryProjectStateResolutionService
  readonly contextPackageResolutionService: RepositoryContextPackageResolutionService
}

export class ControlApiCloudCompositionError extends Error {
  constructor() {
    super('Managed Cloud Control API composition is invalid')
    this.name = 'ControlApiCloudCompositionError'
  }
}

export function createManagedCloudControlApiComposition(
  configuration: ManagedCloudConfiguration,
  logger: StructuredLogger,
  connectionFactory: PostgresConnectionFactory = createPostgresConnection
): ManagedCloudControlApiComposition {
  if (
    configuration.service !== 'control-api' ||
    configuration.database === undefined ||
    configuration.serviceAuthentication === undefined ||
    configuration.restate?.role !== 'caller'
  ) {
    throw new ControlApiCloudCompositionError()
  }

  const authentication = configuration.serviceAuthentication
  const serviceAuthenticator = new PolicyServiceAuthenticator({
    audience: authentication.audience,
    issuer: authentication.issuer,
    logger,
    revocationChecker: new ConfiguredCredentialRevocationChecker(
      authentication.revokedCredentialIds
    ),
    verifier: new Ed25519ServiceCredentialVerifier(authentication.trustedKeys),
  })
  const connection = connectionFactory(configuration.database)
  const catalog = new PostgresCatalogRepository(connection.database)
  const plans = new PostgresExecutionPlanRepository(connection.database)
  const projectStates = new PostgresProjectStateRepository(connection.database)
  const contextPackages = new PostgresContextPackageRepository(connection.database)

  return {
    connection,
    executionAcceptanceService: new DurableExecutionAcceptanceService({
      commands: new CommandInboxService({
        repository: new PostgresCommandAcceptanceRepository(connection.database),
        executionIdFactory: createExecutionId,
        executionPlanValidator: new ExecutionPlanAcceptanceValidator(plans),
      }),
      dispatcher: new RestateExecutionWorkflowDispatcher({
        ingressUrl: configuration.restate.ingressUrl,
      }),
    }),
    executionValidationService: new DurableExecutionValidationService({
      compilerVersion: executionPlanCompilerVersion,
      contextPackages,
      plans,
      profiles: catalog,
      projectStates,
      skills: catalog,
    }),
    profileResolutionService: new RepositoryProfileResolutionService(catalog),
    projectStateResolutionService: new RepositoryProjectStateResolutionService(projectStates),
    contextPackageResolutionService: new RepositoryContextPackageResolutionService(contextPackages),
    serviceAuthenticator,
  }
}
