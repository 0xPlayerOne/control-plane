import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const records = sqliteTable(
  'control_plane_records',
  {
    namespace: text('namespace').notNull(),
    id: text('id').notNull(),
    revision: integer('revision').notNull(),
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.namespace, table.id] })]
)

export const metadata = sqliteTable('control_plane_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const sqliteSchema = { records, metadata }
