import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

export const memoryWriteProposalState = pgEnum('memory_write_proposal_state', [
  'proposed',
  'awaiting_approval',
  'approved',
  'denied',
  'expired',
  'revoked',
  'committing',
  'committed',
  'failed',
  'reconciliation_required',
])

export const memoryWriteProposals = pgTable(
  'memory_write_proposals',
  {
    proposalId: varchar('proposal_id', { length: 30 }).primaryKey(),
    workspaceId: varchar('workspace_id', { length: 30 }).notNull(),
    dedupeHint: varchar('dedupe_hint', { length: 256 }).notNull(),
    state: memoryWriteProposalState('state').notNull(),
    version: integer('version').notNull(),
    proposal: jsonb('proposal').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('memory_write_proposals_workspace_dedupe_unique').on(
      table.workspaceId,
      table.dedupeHint
    ),
    index('memory_write_proposals_state_updated_index').on(table.state, table.updatedAt),
  ]
)
