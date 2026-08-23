import { sql } from 'drizzle-orm'
import { bigint, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core'

export const persistenceConventions = {
  identifiers: 'uuid-v4-database-generated',
  json: 'jsonb',
  names: 'snake_case-plural-tables',
  revisions: 'bigint-starting-at-one',
  softDelete: 'nullable-deleted-at',
  timestamps: 'timestamp-with-time-zone',
} as const

export const idColumn = () => uuid('id').defaultRandom().primaryKey()

export const revisionColumn = () =>
  bigint('revision', { mode: 'bigint' })
    .default(sql`1`)
    .notNull()

export const jsonColumn = <Value = unknown>(name: string) => jsonb(name).$type<Value>().notNull()

export const timestampColumns = () => ({
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
})

export const softDeleteColumns = () => ({
  deletedAt: timestamp('deleted_at', { mode: 'date', withTimezone: true }),
})
