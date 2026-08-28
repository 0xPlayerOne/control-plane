import { and, eq, asc } from 'drizzle-orm'
import type {
  AgentProfile,
  AgentProfileRepository,
  AgentProfileVersion,
  Skill,
  SkillRepository,
  SkillVersion,
} from '@control-plane/domain'
import type { ControlPlaneDatabase } from './connection.js'
import { agentProfileVersions, agentProfiles, skillVersions, skills } from './schema/catalog.js'

export class PostgresCatalogRepository implements AgentProfileRepository, SkillRepository {
  constructor(private readonly database: ControlPlaneDatabase) {}

  async insertAgentProfile(profile: AgentProfile): Promise<boolean> {
    const result = await this.database
      .insert(agentProfiles)
      .values({ ...profile, createdAt: new Date(profile.createdAt) })
      .onConflictDoNothing()
      .returning({ profileId: agentProfiles.profileId })
    return result.length === 1
  }
  async getAgentProfile(profileId: string): Promise<AgentProfile | undefined> {
    const [row] = await this.database
      .select()
      .from(agentProfiles)
      .where(eq(agentProfiles.profileId, profileId))
      .limit(1)
    return row ? parse<AgentProfile>({ ...row, createdAt: row.createdAt.toISOString() }) : undefined
  }
  async insertAgentProfileVersion(version: AgentProfileVersion): Promise<boolean> {
    const result = await this.database
      .insert(agentProfileVersions)
      .values(profileVersionRow(version))
      .onConflictDoNothing()
      .returning({ id: agentProfileVersions.profileVersionId })
    return result.length === 1
  }
  async getAgentProfileVersion(id: string): Promise<AgentProfileVersion | undefined> {
    const [row] = await this.database
      .select()
      .from(agentProfileVersions)
      .where(eq(agentProfileVersions.profileVersionId, id))
      .limit(1)
    return row
      ? parse<AgentProfileVersion>({ ...row, createdAt: row.createdAt.toISOString() })
      : undefined
  }
  async listAgentProfileVersions(profileId: string): Promise<readonly AgentProfileVersion[]> {
    const rows = await this.database
      .select()
      .from(agentProfileVersions)
      .where(eq(agentProfileVersions.profileId, profileId))
      .orderBy(asc(agentProfileVersions.version))
    return rows.map((row) =>
      parse<AgentProfileVersion>({ ...row, createdAt: row.createdAt.toISOString() })
    )
  }
  async compareAndSetAgentProfileVersion(
    expectedRevision: number,
    version: AgentProfileVersion
  ): Promise<boolean> {
    const result = await this.database
      .update(agentProfileVersions)
      .set(profileVersionRow(version))
      .where(
        and(
          eq(agentProfileVersions.profileVersionId, version.profileVersionId),
          eq(agentProfileVersions.revision, expectedRevision)
        )
      )
      .returning({ id: agentProfileVersions.profileVersionId })
    return result.length === 1
  }

  async insertSkill(skill: Skill): Promise<boolean> {
    const result = await this.database
      .insert(skills)
      .values({ ...skill, createdAt: new Date(skill.createdAt) })
      .onConflictDoNothing()
      .returning({ skillId: skills.skillId })
    return result.length === 1
  }
  async getSkill(skillId: string): Promise<Skill | undefined> {
    const [row] = await this.database
      .select()
      .from(skills)
      .where(eq(skills.skillId, skillId))
      .limit(1)
    return row ? parse<Skill>({ ...row, createdAt: row.createdAt.toISOString() }) : undefined
  }
  async insertSkillVersion(version: SkillVersion): Promise<boolean> {
    const result = await this.database
      .insert(skillVersions)
      .values(skillVersionRow(version))
      .onConflictDoNothing()
      .returning({ id: skillVersions.skillVersionId })
    return result.length === 1
  }
  async getSkillVersion(id: string): Promise<SkillVersion | undefined> {
    const [row] = await this.database
      .select()
      .from(skillVersions)
      .where(eq(skillVersions.skillVersionId, id))
      .limit(1)
    return row ? parse<SkillVersion>({ ...row, createdAt: row.createdAt.toISOString() }) : undefined
  }
  async listSkillVersions(skillId: string): Promise<readonly SkillVersion[]> {
    const rows = await this.database
      .select()
      .from(skillVersions)
      .where(eq(skillVersions.skillId, skillId))
      .orderBy(asc(skillVersions.createdAt))
    return rows.map((row) =>
      parse<SkillVersion>({ ...row, createdAt: row.createdAt.toISOString() })
    )
  }
  async compareAndSetSkillVersion(
    expectedRevision: number,
    version: SkillVersion
  ): Promise<boolean> {
    const result = await this.database
      .update(skillVersions)
      .set(skillVersionRow(version))
      .where(
        and(
          eq(skillVersions.skillVersionId, version.skillVersionId),
          eq(skillVersions.revision, expectedRevision)
        )
      )
      .returning({ id: skillVersions.skillVersionId })
    return result.length === 1
  }
}

function profileVersionRow(version: AgentProfileVersion) {
  return { ...version, createdAt: new Date(version.createdAt) }
}

function skillVersionRow(version: SkillVersion) {
  return { ...version, createdAt: new Date(version.createdAt) }
}

function parse<Value>(value: unknown): Value {
  return structuredClone(value) as Value
}
