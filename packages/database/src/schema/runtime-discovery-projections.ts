import type {
  ExternalSessionDiscoveryReadModel,
  RuntimeConnectionDiscoveryReadModel,
} from '@control-plane/contracts'
import { index, jsonb, pgEnum, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core'

export const runtimeDiscoveryResourceKind = pgEnum('runtime_discovery_resource_kind', [
  'runtime_connection',
  'external_session',
])

const identifier = (name: string) => varchar(name, { length: 30 })

export const runtimeDiscoveryProjections = pgTable(
  'runtime_discovery_projections',
  {
    kind: runtimeDiscoveryResourceKind('kind').notNull(),
    resourceId: identifier('resource_id').notNull(),
    workspaceId: identifier('workspace_id').notNull(),
    projectId: identifier('project_id'),
    runtimeNodeRefId: identifier('runtime_node_ref_id'),
    model: jsonb('model')
      .$type<RuntimeConnectionDiscoveryReadModel | ExternalSessionDiscoveryReadModel>()
      .notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.resourceId] }),
    index('runtime_discovery_workspace_kind_index').on(
      table.workspaceId,
      table.kind,
      table.resourceId
    ),
    index('runtime_discovery_scope_index').on(
      table.workspaceId,
      table.projectId,
      table.runtimeNodeRefId
    ),
  ]
)
