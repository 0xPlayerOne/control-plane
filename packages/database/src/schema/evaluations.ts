import type { EvalRun, ReleaseAuditRecord } from '@control-plane/production-readiness'
import { bigserial, index, jsonb, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core'

export const evaluationRunStatus = pgEnum('evaluation_run_status', ['failed', 'passed'])
export const releaseAuditAction = pgEnum('release_audit_action', ['promote', 'rollback'])

export const evaluationRuns = pgTable(
  'evaluation_runs',
  {
    evalRunId: varchar('eval_run_id', { length: 256 }).primaryKey(),
    status: evaluationRunStatus('status').notNull(),
    evidence: jsonb('evidence').$type<EvalRun>().notNull(),
    startedAt: timestamp('started_at', { mode: 'date', withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { mode: 'date', withTimezone: true }).notNull(),
  },
  (table) => [index('evaluation_runs_status_completed_index').on(table.status, table.completedAt)]
)

export const releaseAuditRecords = pgTable(
  'release_audit_records',
  {
    sequence: bigserial('sequence', { mode: 'number' }).notNull().unique(),
    releaseAuditId: varchar('release_audit_id', { length: 36 }).primaryKey(),
    releaseGateId: varchar('release_gate_id', { length: 256 }).notNull(),
    action: releaseAuditAction('action').notNull(),
    evidence: jsonb('evidence').$type<ReleaseAuditRecord>().notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull(),
  },
  (table) => [
    index('release_audit_records_gate_sequence_index').on(table.releaseGateId, table.sequence),
  ]
)
