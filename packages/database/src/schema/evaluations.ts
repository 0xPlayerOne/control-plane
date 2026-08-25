import type { EvalRun } from '@control-plane/production-readiness'
import { index, jsonb, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core'

export const evaluationRunStatus = pgEnum('evaluation_run_status', ['failed', 'passed'])

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
