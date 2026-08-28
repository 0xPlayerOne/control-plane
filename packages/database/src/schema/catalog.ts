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

export const catalogVersionLifecycle = pgEnum('catalog_version_lifecycle', [
  'draft',
  'published',
  'deprecated',
  'revoked',
  'superseded',
])

const identifier = (name: string) => varchar(name, { length: 64 })

export const agentProfiles = pgTable('agent_profiles', {
  profileId: identifier('profile_id').primaryKey(),
  displayName: varchar('display_name', { length: 128 }).notNull(),
  ownership: jsonb('ownership').notNull(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull(),
})

export const agentProfileVersions = pgTable(
  'agent_profile_versions',
  {
    profileVersionId: identifier('profile_version_id').primaryKey(),
    profileId: identifier('profile_id')
      .notNull()
      .references(() => agentProfiles.profileId),
    version: integer('version').notNull(),
    revision: integer('revision').notNull(),
    lifecycle: catalogVersionLifecycle('lifecycle').notNull(),
    contentDigest: varchar('content_digest', { length: 71 }).notNull(),
    definition: jsonb('definition').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull(),
    lifecycleMetadata: jsonb('lifecycle_metadata').notNull(),
  },
  (table) => [
    uniqueIndex('agent_profile_versions_number_unique').on(table.profileId, table.version),
    index('agent_profile_versions_profile_index').on(table.profileId),
  ]
)

export const skills = pgTable('skills', {
  skillId: identifier('skill_id').primaryKey(),
  displayName: varchar('display_name', { length: 128 }).notNull(),
  ownership: jsonb('ownership').notNull(),
  provenance: jsonb('provenance').notNull(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull(),
})

export const skillVersions = pgTable(
  'skill_versions',
  {
    skillVersionId: identifier('skill_version_id').primaryKey(),
    skillId: identifier('skill_id')
      .notNull()
      .references(() => skills.skillId),
    revision: integer('revision').notNull(),
    lifecycle: catalogVersionLifecycle('lifecycle').notNull(),
    manifest: jsonb('manifest').notNull(),
    content: jsonb('content').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull(),
    lifecycleMetadata: jsonb('lifecycle_metadata').notNull(),
  },
  (table) => [index('skill_versions_skill_index').on(table.skillId)]
)
