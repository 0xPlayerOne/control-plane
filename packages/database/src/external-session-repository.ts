import {
  ExternalSessionSchema,
  type ExternalSession,
  type ExternalSessionListScope,
  type ExternalSessionRepository,
} from '@control-plane/runtime-sdk'
import { and, asc, eq } from 'drizzle-orm'
import type { ControlPlaneDatabase } from './connection.js'
import { externalSessions } from './schema/external-sessions.js'

export class PostgresExternalSessionRepository implements ExternalSessionRepository {
  constructor(readonly database: ControlPlaneDatabase) {}

  async insert(sessionValue: ExternalSession): Promise<boolean> {
    const session = ExternalSessionSchema.parse(sessionValue)
    const inserted = await this.database
      .insert(externalSessions)
      .values(toRow(session))
      .onConflictDoNothing()
      .returning({ externalSessionId: externalSessions.externalSessionId })
    return inserted.length === 1
  }

  async get(externalSessionId: string): Promise<ExternalSession | undefined> {
    const [row] = await this.database
      .select()
      .from(externalSessions)
      .where(eq(externalSessions.externalSessionId, externalSessionId))
      .limit(1)
    return row ? fromRow(row) : undefined
  }

  async findByNativeIdentity(
    runtimeConnectionId: string,
    opaqueNativeSessionId: string
  ): Promise<ExternalSession | undefined> {
    const [row] = await this.database
      .select()
      .from(externalSessions)
      .where(
        and(
          eq(externalSessions.runtimeConnectionId, runtimeConnectionId),
          eq(externalSessions.opaqueNativeSessionId, opaqueNativeSessionId)
        )
      )
      .limit(1)
    return row ? fromRow(row) : undefined
  }

  async list(scope: ExternalSessionListScope): Promise<readonly ExternalSession[]> {
    const conditions = [eq(externalSessions.workspaceId, scope.workspaceId)]
    if (scope.projectId !== undefined) {
      conditions.push(eq(externalSessions.projectId, scope.projectId))
    }
    if (scope.runtimeConnectionId !== undefined) {
      conditions.push(eq(externalSessions.runtimeConnectionId, scope.runtimeConnectionId))
    }
    const rows = await this.database
      .select()
      .from(externalSessions)
      .where(and(...conditions))
      .orderBy(asc(externalSessions.externalSessionId))
    return rows.map(fromRow)
  }

  async compareAndSet(expectedVersion: number, sessionValue: ExternalSession): Promise<boolean> {
    const session = ExternalSessionSchema.parse(sessionValue)
    const current = await this.get(session.externalSessionId)
    if (!current || !sameImmutableIdentity(current, session)) return false
    const updated = await this.database
      .update(externalSessions)
      .set({
        state: session.state,
        capabilitySnapshot: session.capabilitySnapshot,
        safeMetadata: session.safeMetadata,
        lastObservedAt: new Date(session.lastObservedAt),
        version: session.version,
        updatedAt: new Date(session.updatedAt),
      })
      .where(
        and(
          eq(externalSessions.externalSessionId, session.externalSessionId),
          eq(externalSessions.version, expectedVersion)
        )
      )
      .returning({ externalSessionId: externalSessions.externalSessionId })
    return updated.length === 1
  }
}

type ExternalSessionRow = typeof externalSessions.$inferSelect

function toRow(session: ExternalSession): typeof externalSessions.$inferInsert {
  return {
    externalSessionId: session.externalSessionId,
    runtimeConnectionId: session.runtimeConnectionId,
    opaqueNativeSessionId: session.opaqueNativeSessionId,
    workspaceId: session.workspaceId,
    projectId: session.projectId ?? null,
    state: session.state,
    ownership: session.ownership,
    capabilitySnapshot: session.capabilitySnapshot,
    safeMetadata: session.safeMetadata,
    lastObservedAt: new Date(session.lastObservedAt),
    version: session.version,
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
  }
}

function fromRow(row: ExternalSessionRow): ExternalSession {
  return ExternalSessionSchema.parse({
    externalSessionId: row.externalSessionId,
    runtimeConnectionId: row.runtimeConnectionId,
    opaqueNativeSessionId: row.opaqueNativeSessionId,
    workspaceId: row.workspaceId,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    state: row.state,
    ownership: row.ownership,
    capabilitySnapshot: row.capabilitySnapshot,
    safeMetadata: row.safeMetadata,
    lastObservedAt: row.lastObservedAt.toISOString(),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

function sameImmutableIdentity(left: ExternalSession, right: ExternalSession): boolean {
  return (
    left.externalSessionId === right.externalSessionId &&
    left.runtimeConnectionId === right.runtimeConnectionId &&
    left.opaqueNativeSessionId === right.opaqueNativeSessionId &&
    left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId &&
    JSON.stringify(left.ownership) === JSON.stringify(right.ownership) &&
    left.createdAt === right.createdAt
  )
}
