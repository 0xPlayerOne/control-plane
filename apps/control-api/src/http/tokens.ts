import type { HealthResponse, ReadinessResponse, StructuredLogger } from '@control-plane/bootstrap'
import type { ApplicationMetadata } from '@control-plane/config'
import type { Telemetry } from '@control-plane/telemetry'

export const API_HEALTH = Symbol('API_HEALTH')
export const API_LOGGER = Symbol('API_LOGGER')
export const API_METADATA = Symbol('API_METADATA')
export const API_READINESS = Symbol('API_READINESS')
export const API_TELEMETRY = Symbol('API_TELEMETRY')

export interface ApiRuntimeBindings {
  readonly health: () => HealthResponse
  readonly logger: StructuredLogger
  readonly metadata: ApplicationMetadata<'control-api'>
  readonly readiness: () => ReadinessResponse
  readonly telemetry?: Telemetry
}
