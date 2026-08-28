import { pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core'

export const credentialSecrets = pgTable(
  'credential_secrets',
  {
    locator: varchar('locator', { length: 256 }).notNull(),
    version: varchar('version', { length: 64 }).notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: varchar('iv', { length: 64 }).notNull(),
    authTag: varchar('auth_tag', { length: 64 }).notNull(),
    keyReference: varchar('key_reference', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.locator, table.version] })]
)
