import { pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import type { SecretEncryptionVersion } from '@control-plane/credential-vault'

export const credentialSecrets = pgTable(
  'credential_secrets',
  {
    locator: varchar('locator', { length: 256 }).notNull(),
    version: varchar('version', { length: 64 }).notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: varchar('iv', { length: 64 }).notNull(),
    authTag: varchar('auth_tag', { length: 64 }).notNull(),
    keyReference: varchar('key_reference', { length: 128 }).notNull(),
    encryptionVersion: varchar('encryption_version', { length: 32 })
      .$type<SecretEncryptionVersion>()
      .default('legacy-v0')
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.locator, table.version] })]
)
