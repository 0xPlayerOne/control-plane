import { randomUUID } from 'node:crypto'
import type { ApplicationEnvironment, RawEnvironment } from './environment.js'

export interface ApplicationMetadata<Service extends string = string> {
  readonly serviceName: Service
  readonly version: string
  readonly commitSha: string
  readonly environment: ApplicationEnvironment
  readonly instanceId: string
}

export interface MetadataParseResult<Service extends string> {
  readonly metadata?: ApplicationMetadata<Service>
  readonly invalid: readonly string[]
  readonly missing: readonly string[]
}

export function parseApplicationMetadata<Service extends string>(
  serviceName: Service,
  applicationEnvironment: ApplicationEnvironment,
  environment: RawEnvironment
): MetadataParseResult<Service> {
  const productionLike =
    applicationEnvironment === 'staging' || applicationEnvironment === 'production'
  const missing = [
    ...(productionLike && !environment.SERVICE_VERSION ? ['SERVICE_VERSION'] : []),
    ...(productionLike && !environment.COMMIT_SHA ? ['COMMIT_SHA'] : []),
  ]
  const version = environment.SERVICE_VERSION ?? defaultVersion(applicationEnvironment)
  const commitSha = environment.COMMIT_SHA ?? defaultCommit(applicationEnvironment)
  const instanceId = environment.INSTANCE_ID ?? randomUUID()
  const invalid = [
    ...(!isMetadataValue(version) ? ['SERVICE_VERSION'] : []),
    ...(!isMetadataValue(commitSha) ? ['COMMIT_SHA'] : []),
    ...(!isMetadataValue(instanceId) ? ['INSTANCE_ID'] : []),
  ]
  if (missing.length || invalid.length) return { invalid, missing }

  return {
    invalid,
    missing,
    metadata: {
      serviceName,
      version,
      commitSha,
      environment: applicationEnvironment,
      instanceId,
    },
  }
}

function defaultVersion(environment: ApplicationEnvironment): string {
  return environment === 'test' ? '0.0.0-test' : '0.0.0-development'
}

function defaultCommit(environment: ApplicationEnvironment): string {
  return environment === 'test' ? 'test' : 'local'
}

function isMetadataValue(value: string): boolean {
  return value.trim().length > 0 && value.length <= 128 && !/[\r\n]/.test(value)
}
