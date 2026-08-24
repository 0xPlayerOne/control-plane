import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

export const runtimeConnectionType = pgEnum('runtime_connection_type', [
  'managed_cloud',
  'managed_local',
  'external_local',
])
export const runtimeConnectionLocation = pgEnum('runtime_connection_location', [
  'local_device',
  'managed_sandbox',
])
export const runtimeConnectionStatus = pgEnum('runtime_connection_status', [
  'connected',
  'degraded',
  'unavailable',
  'disconnected',
  'expired',
  'revoked',
])
export const runtimeConnectionHealth = pgEnum('runtime_connection_health', [
  'healthy',
  'degraded',
  'unavailable',
])
export const runtimeCompatibilityState = pgEnum('runtime_compatibility_state', [
  'compatible',
  'degraded',
  'untested',
  'incompatible',
  'deprecated',
  'revoked',
  'unavailable',
  'capability_missing',
])
export const runtimeAvailabilityState = pgEnum('runtime_availability_state', [
  'healthy',
  'degraded',
  'reconnecting',
  'offline',
  'incompatible',
  'revoked',
  'stale',
  'unknown',
])
export const runtimeCapabilityVerification = pgEnum('runtime_capability_verification', [
  'verified',
  'unverified',
])

const identifier = (name: string) => varchar(name, { length: 30 })

export const runtimeConnections = pgTable(
  'runtime_connections',
  {
    runtimeConnectionId: identifier('runtime_connection_id').primaryKey(),
    identityDigest: varchar('identity_digest', { length: 71 }).notNull(),
    connectionType: runtimeConnectionType('connection_type').notNull(),
    runtimeNodeRefId: identifier('runtime_node_ref_id'),
    runtimeDefinitionId: identifier('runtime_definition_id').notNull(),
    location: runtimeConnectionLocation('location').notNull(),
    opaqueNativeRef: varchar('opaque_native_ref', { length: 31 }),
    adapterVersion: varchar('adapter_version', { length: 32 }).notNull(),
    driverVersion: varchar('driver_version', { length: 32 }).notNull(),
    harnessVersion: varchar('harness_version', { length: 32 }).notNull(),
    status: runtimeConnectionStatus('status').notNull(),
    health: runtimeConnectionHealth('health').notNull(),
    capabilities: jsonb('capabilities').notNull(),
    compatibilityState: runtimeCompatibilityState('compatibility_state').notNull(),
    availabilityState: runtimeAvailabilityState('availability_state'),
    protocolVersion: varchar('protocol_version', { length: 32 }),
    capabilitySnapshotVersion: bigint('capability_snapshot_version', { mode: 'number' }),
    capabilitySnapshotObservedAt: timestamp('capability_snapshot_observed_at', {
      mode: 'date',
      withTimezone: true,
    }),
    capabilitySnapshotExpiresAt: timestamp('capability_snapshot_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    capabilityVerification: runtimeCapabilityVerification('capability_verification'),
    lastHealthReportSequence: bigint('last_health_report_sequence', { mode: 'number' }),
    lastHealthReportDigest: varchar('last_health_report_digest', { length: 71 }),
    limitations: jsonb('limitations').notNull(),
    diagnostics: jsonb('diagnostics'),
    lastDiscoveredAt: timestamp('last_discovered_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { mode: 'date', withTimezone: true }).notNull(),
    lastHealthCheckAt: timestamp('last_health_check_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp('expires_at', { mode: 'date', withTimezone: true }),
    version: bigint('version', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('runtime_connections_identity_unique').on(table.identityDigest),
    index('runtime_connections_node_index').on(table.runtimeNodeRefId),
    index('runtime_connections_status_freshness_index').on(table.status, table.expiresAt),
    index('runtime_connections_availability_freshness_index').on(
      table.availabilityState,
      table.capabilitySnapshotExpiresAt
    ),
    index('runtime_connections_definition_index').on(table.runtimeDefinitionId),
    check(
      'runtime_connections_location_check',
      sql`(${table.connectionType} = 'managed_cloud' and ${table.location} = 'managed_sandbox' and ${table.runtimeNodeRefId} is null) or (${table.connectionType} <> 'managed_cloud' and ${table.location} = 'local_device' and ${table.runtimeNodeRefId} is not null)`
    ),
    check(
      'runtime_connections_native_ref_check',
      sql`${table.opaqueNativeRef} is null or ${table.opaqueNativeRef} ~ '^nref_[0-9A-HJKMNP-TV-Z]{26}$'`
    ),
  ]
)
