import {
  DurableExecutionAcceptanceService,
  DurableExecutionValidationService,
  RestateExecutionWorkflowDispatcher,
  createExecutionId,
  RepositoryProfileResolutionService,
  RepositoryProjectStateResolutionService,
  RepositoryContextPackageResolutionService,
} from '@control-plane/control-api'
import { CommandInboxService } from '@control-plane/domain'
import { ExecutionPlanAcceptanceValidator } from '@control-plane/execution-plan'
import {
  SqliteCommandAcceptanceRepository,
  SqliteContextPackageRepository,
  SqliteExecutionPlanRepository,
  SqliteProjectStateRepository,
  SqliteRuntimeDiscoveryRepository,
  SqliteVersionedCatalogRepository,
  type SqlitePersistenceProvider,
} from '@control-plane/sqlite-persistence'

export class LocalControlApiComposition {
  readonly catalog: SqliteVersionedCatalogRepository
  readonly contextPackages: SqliteContextPackageRepository
  readonly executionPlans: SqliteExecutionPlanRepository
  readonly projectStates: SqliteProjectStateRepository
  readonly executionAcceptanceService: DurableExecutionAcceptanceService
  readonly executionValidationService: DurableExecutionValidationService
  readonly profileResolutionService: RepositoryProfileResolutionService
  readonly projectStateResolutionService: RepositoryProjectStateResolutionService
  readonly contextPackageResolutionService: RepositoryContextPackageResolutionService
  readonly runtimeDiscoveryRepository: SqliteRuntimeDiscoveryRepository

  constructor(persistence: SqlitePersistenceProvider, restateIngressUrl: string) {
    this.catalog = new SqliteVersionedCatalogRepository(persistence)
    this.contextPackages = new SqliteContextPackageRepository(persistence)
    this.executionPlans = new SqliteExecutionPlanRepository(persistence)
    this.projectStates = new SqliteProjectStateRepository(persistence)
    this.runtimeDiscoveryRepository = new SqliteRuntimeDiscoveryRepository(persistence)
    this.executionAcceptanceService = new DurableExecutionAcceptanceService({
      commands: new CommandInboxService({
        repository: new SqliteCommandAcceptanceRepository(persistence),
        executionIdFactory: createExecutionId,
        executionPlanValidator: new ExecutionPlanAcceptanceValidator(this.executionPlans),
      }),
      dispatcher: new RestateExecutionWorkflowDispatcher({ ingressUrl: restateIngressUrl }),
    })
    this.executionValidationService = new DurableExecutionValidationService({
      compilerVersion: '1.0.0',
      contextPackages: this.contextPackages,
      plans: this.executionPlans,
      profiles: this.catalog,
      projectStates: this.projectStates,
      skills: this.catalog,
    })
    this.profileResolutionService = new RepositoryProfileResolutionService(this.catalog)
    this.projectStateResolutionService = new RepositoryProjectStateResolutionService(
      this.projectStates
    )
    this.contextPackageResolutionService = new RepositoryContextPackageResolutionService(
      this.contextPackages
    )
  }
}
