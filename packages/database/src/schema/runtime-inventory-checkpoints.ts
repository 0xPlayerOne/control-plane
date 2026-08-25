import { sql } from 'drizzle-orm'
import { bigint, check, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core'

const identifier = (name: string) => varchar(name, { length: 30 })

export const runtimeInventoryCheckpoints = pgTable(
  'runtime_inventory_checkpoints',
  {
    runtimeNodeRefId: identifier('runtime_node_ref_id').primaryKey(),
    workspaceId: identifier('workspace_id').notNull(),
    snapshotVersion: bigint('snapshot_version', { mode: 'number' }).notNull(),
    snapshotDigest: varchar('snapshot_digest', { length: 71 }).notNull(),
    observedAt: timestamp('observed_at', { mode: 'date', withTimezone: true }).notNull(),
    activeRuntimeRefs: jsonb('active_runtime_refs').notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull(),
  },
  (table) => [
    check(
      'runtime_inventory_checkpoints_snapshot_version_check',
      sql`${table.snapshotVersion} > 0`
    ),
    check('runtime_inventory_checkpoints_revision_check', sql`${table.revision} > 0`),
    check(
      'runtime_inventory_checkpoints_active_refs_check',
      sql`jsonb_typeof(${table.activeRuntimeRefs}) = 'array'`
    ),
  ]
)
