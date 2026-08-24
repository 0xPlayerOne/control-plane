import type { ExternalSession } from '@control-plane/runtime-sdk'
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { runtimeConnections } from './runtime-connections.js'

export const externalSessionState = pgEnum('external_session_state', [
  'active',
  'closed',
  'removed',
  'revoked',
])

const identifier = (name: string) => varchar(name, { length: 30 })

export const externalSessions = pgTable(
  'external_sessions',
  {
    externalSessionId: identifier('external_session_id').primaryKey(),
    runtimeConnectionId: identifier('runtime_connection_id')
      .notNull()
      .references(() => runtimeConnections.runtimeConnectionId),
    opaqueNativeSessionId: varchar('opaque_native_session_id', { length: 31 }).notNull(),
    workspaceId: identifier('workspace_id').notNull(),
    projectId: identifier('project_id'),
    state: externalSessionState('state').notNull(),
    ownership: jsonb('ownership').$type<ExternalSession['ownership']>().notNull(),
    capabilitySnapshot: jsonb('capability_snapshot')
      .$type<ExternalSession['capabilitySnapshot']>()
      .notNull(),
    safeMetadata: jsonb('safe_metadata').$type<ExternalSession['safeMetadata']>().notNull(),
    lastObservedAt: timestamp('last_observed_at', { mode: 'date', withTimezone: true }).notNull(),
    version: bigint('version', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('external_sessions_runtime_native_unique').on(
      table.runtimeConnectionId,
      table.opaqueNativeSessionId
    ),
    index('external_sessions_scope_state_index').on(
      table.workspaceId,
      table.projectId,
      table.state
    ),
    index('external_sessions_runtime_index').on(table.runtimeConnectionId),
  ]
)
