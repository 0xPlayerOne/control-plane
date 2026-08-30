import { integer, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core'

type MigrationProvenance = Readonly<Record<string, unknown>>

export const profileMigrations = pgTable('profile_migrations', {
  exportId: varchar('export_id', { length: 128 }).primaryKey(),
  manifestDigest: varchar('manifest_digest', { length: 71 }).notNull(),
  sourceProfile: varchar('source_profile', { length: 32 }).notNull(),
  destinationProfile: varchar('destination_profile', { length: 32 }).notNull(),
  recordCount: integer('record_count').notNull(),
  artifactCount: integer('artifact_count').notNull(),
  provenance: jsonb('provenance').$type<MigrationProvenance>().notNull(),
  appliedAt: timestamp('applied_at', { mode: 'date', withTimezone: true }).notNull(),
})
