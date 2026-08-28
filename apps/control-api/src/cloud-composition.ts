import type { StructuredLogger } from '@control-plane/bootstrap'
import type { ManagedCloudConfiguration } from '@control-plane/config'
import {
  createPostgresConnection,
  PostgresCatalogRepository,
  PostgresContextPackageRepository,
  PostgresExecutionPlanRepository,
  PostgresProjectStateRepository,
  type PostgresConnection,
} from '@control-plane/database'
import {
  ConfiguredCredentialRevocationChecker,
  Ed25519ServiceCredentialVerifier,
  PolicyServiceAuthenticator,
} from './auth/service-authentication.js'
import { DurableExecutionValidationService } from './executions/execution-validation.service.js'

const executionPlanCompilerVersion = '1.0.0'

export type PostgresConnectionFactory = typeof createPostgresConnection

export interface ManagedCloudControlApiComposition {
  readonly connection: PostgresConnection
  readonly executionValidationService: DurableExecutionValidationService
  readonly serviceAuthenticator: PolicyServiceAuthenticator
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
    configuration.serviceAuthentication === undefined
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

  return {
    connection,
    executionValidationService: new DurableExecutionValidationService({
      compilerVersion: executionPlanCompilerVersion,
      contextPackages: new PostgresContextPackageRepository(connection.database),
      plans: new PostgresExecutionPlanRepository(connection.database),
      profiles: catalog,
      projectStates: new PostgresProjectStateRepository(connection.database),
      skills: catalog,
    }),
    serviceAuthenticator,
  }
}
