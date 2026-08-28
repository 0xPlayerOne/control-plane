import { ConfigurationError } from './service.js'
import { loadDatabaseCredentials, type DatabaseCredentials } from './database.js'
import type { RawEnvironment } from './environment.js'

export const managedCloudServices = [
  'control-api',
  'workflow-worker',
  'runtime-worker',
  'runtime-gateway',
  'tool-gateway',
] as const

export type ManagedCloudService = (typeof managedCloudServices)[number]

export interface ManagedCloudObjectStoreConfiguration {
  readonly endpoint: string
  readonly bucket: string
  readonly region: 'auto'
  readonly accessKeyId: string
  readonly secretAccessKey: string
}

export interface ManagedCloudRestateConfiguration {
  readonly ingressUrl: string
  readonly serviceAuthToken: string
}

export interface ManagedCloudConfiguration {
  readonly service: ManagedCloudService
  readonly database?: DatabaseCredentials<'application'>
  readonly objectStore?: ManagedCloudObjectStoreConfiguration
  readonly restate?: ManagedCloudRestateConfiguration
  readonly serviceAuthToken: string
  readonly secretEncryptionKey: string
}

const requiredVariables: Record<ManagedCloudService, readonly string[]> = {
  'control-api': [
    'DATABASE_URL',
    'CONTROL_PLANE_SECRET_ENCRYPTION_KEY',
    'CONTROL_PLANE_SERVICE_AUTH_TOKEN',
    'R2_ENDPOINT',
    'R2_BUCKET',
    'R2_REGION',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
  ],
  'workflow-worker': [
    'DATABASE_URL',
    'CONTROL_PLANE_SECRET_ENCRYPTION_KEY',
    'CONTROL_PLANE_SERVICE_AUTH_TOKEN',
    'RESTATE_INGRESS_URL',
    'RESTATE_SERVICE_AUTH_TOKEN',
    'R2_ENDPOINT',
    'R2_BUCKET',
    'R2_REGION',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
  ],
  'runtime-worker': [
    'DATABASE_URL',
    'CONTROL_PLANE_SECRET_ENCRYPTION_KEY',
    'CONTROL_PLANE_SERVICE_AUTH_TOKEN',
    'R2_ENDPOINT',
    'R2_BUCKET',
    'R2_REGION',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
  ],
  'runtime-gateway': ['CONTROL_PLANE_SERVICE_AUTH_TOKEN'],
  'tool-gateway': ['CONTROL_PLANE_SERVICE_AUTH_TOKEN'],
}

export function managedCloudEnvironmentManifest(): Readonly<
  Record<ManagedCloudService, readonly string[]>
> {
  return requiredVariables
}

export function loadManagedCloudConfiguration(
  environment: RawEnvironment,
  service: ManagedCloudService
): ManagedCloudConfiguration {
  const missing = requiredVariables[service].filter((variable) => !environment[variable])
  const invalid: string[] = []
  const serviceAuthToken = environment['CONTROL_PLANE_SERVICE_AUTH_TOKEN']
  const secretEncryptionKey = environment['CONTROL_PLANE_SECRET_ENCRYPTION_KEY']
  if (serviceAuthToken !== undefined && serviceAuthToken.length < 32) {
    invalid.push('CONTROL_PLANE_SERVICE_AUTH_TOKEN')
  }
  if (secretEncryptionKey !== undefined && !isEncryptionKey(secretEncryptionKey)) {
    invalid.push('CONTROL_PLANE_SECRET_ENCRYPTION_KEY')
  }
  if (missing.length || invalid.length) {
    throw new ConfigurationError({
      code: 'INVALID_MANAGED_CLOUD_CONFIGURATION',
      service,
      invalid: [...new Set(invalid)].sort(),
      missing: [...new Set(missing)].sort(),
    })
  }

  const database = requiredVariables[service].includes('DATABASE_URL')
    ? loadDatabaseCredentials(environment, 'application')
    : undefined
  const objectStore = requiredVariables[service].includes('R2_ENDPOINT')
    ? loadObjectStoreConfiguration(environment)
    : undefined
  const restate = requiredVariables[service].includes('RESTATE_INGRESS_URL')
    ? loadRestateConfiguration(environment)
    : undefined

  return {
    service,
    ...(database === undefined ? {} : { database }),
    ...(objectStore === undefined ? {} : { objectStore }),
    ...(restate === undefined ? {} : { restate }),
    serviceAuthToken: serviceAuthToken as string,
    secretEncryptionKey: secretEncryptionKey as string,
  }
}

function loadObjectStoreConfiguration(
  environment: RawEnvironment
): ManagedCloudObjectStoreConfiguration {
  const endpoint = environment['R2_ENDPOINT'] as string
  const bucket = environment['R2_BUCKET'] as string
  const region = environment['R2_REGION'] as string
  const accessKeyId = environment['R2_ACCESS_KEY_ID'] as string
  const secretAccessKey = environment['R2_SECRET_ACCESS_KEY'] as string
  if (!isHttpsUrl(endpoint) || region !== 'auto' || !/^[A-Za-z0-9._-]{3,63}$/.test(bucket)) {
    throw new ConfigurationError({
      code: 'INVALID_MANAGED_CLOUD_CONFIGURATION',
      invalid: [
        ...(!isHttpsUrl(endpoint) ? ['R2_ENDPOINT'] : []),
        ...(region !== 'auto' ? ['R2_REGION'] : []),
        ...(!/^[A-Za-z0-9._-]{3,63}$/.test(bucket) ? ['R2_BUCKET'] : []),
      ],
      missing: [],
      component: 'r2',
    })
  }
  return { endpoint, bucket, region: 'auto', accessKeyId, secretAccessKey }
}

function loadRestateConfiguration(environment: RawEnvironment): ManagedCloudRestateConfiguration {
  const ingressUrl = environment['RESTATE_INGRESS_URL'] as string
  const serviceAuthToken = environment['RESTATE_SERVICE_AUTH_TOKEN'] as string
  if (!isHttpsUrl(ingressUrl) || serviceAuthToken.length < 32) {
    throw new ConfigurationError({
      code: 'INVALID_MANAGED_CLOUD_CONFIGURATION',
      invalid: [
        ...(!isHttpsUrl(ingressUrl) ? ['RESTATE_INGRESS_URL'] : []),
        ...(serviceAuthToken.length < 32 ? ['RESTATE_SERVICE_AUTH_TOKEN'] : []),
      ],
      missing: [],
      component: 'restate',
    })
  }
  return { ingressUrl, serviceAuthToken }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isEncryptionKey(value: string): boolean {
  if (/^[0-9a-f]{64}$/i.test(value)) return true
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false
  return Buffer.from(value, 'base64url').length === 32
}
