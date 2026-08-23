import { z } from 'zod'

export type OpaqueIdentifier<Kind extends string> = string & {
  readonly __identifierKind: Kind
}

const opaqueIdentifier = <Kind extends string>(prefix: string, kind: Kind) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`), `Expected a canonical opaque ${kind}`)
    .transform((value) => value as OpaqueIdentifier<Kind>)

export const IdentifierSchemas = {
  requestId: opaqueIdentifier('req', 'request ID'),
  commandId: opaqueIdentifier('cmd', 'command ID'),
  workspaceId: opaqueIdentifier('wsp', 'workspace ID'),
  projectId: opaqueIdentifier('prj', 'project ID'),
  taskId: opaqueIdentifier('tsk', 'task ID'),
  agentId: opaqueIdentifier('agt', 'Agent ID'),
  profileId: opaqueIdentifier('prf', 'profile ID'),
  profileVersionId: opaqueIdentifier('pfv', 'profile-version ID'),
  skillId: opaqueIdentifier('skl', 'Skill ID'),
  skillVersionId: opaqueIdentifier('skv', 'skill-version ID'),
  executionId: opaqueIdentifier('exe', 'execution ID'),
  attemptId: opaqueIdentifier('att', 'attempt ID'),
  workflowId: opaqueIdentifier('wfl', 'workflow ID'),
  interactionId: opaqueIdentifier('int', 'interaction ID'),
  runtimeDefinitionId: opaqueIdentifier('rtd', 'runtime-definition ID'),
  runtimeNodeRefId: opaqueIdentifier('rnr', 'runtime-node reference ID'),
  runtimeConnectionId: opaqueIdentifier('rtc', 'runtime-connection ID'),
  externalSessionId: opaqueIdentifier('ses', 'external-session ID'),
  artifactId: opaqueIdentifier('art', 'Artifact reference ID'),
  eventId: opaqueIdentifier('evt', 'event ID'),
  traceId: opaqueIdentifier('trc', 'trace ID'),
} as const

export type RequestId = z.output<(typeof IdentifierSchemas)['requestId']>
export type CommandId = z.output<(typeof IdentifierSchemas)['commandId']>
export type WorkspaceId = z.output<(typeof IdentifierSchemas)['workspaceId']>
export type ProjectId = z.output<(typeof IdentifierSchemas)['projectId']>
export type TaskId = z.output<(typeof IdentifierSchemas)['taskId']>
export type AgentId = z.output<(typeof IdentifierSchemas)['agentId']>
export type ProfileId = z.output<(typeof IdentifierSchemas)['profileId']>
export type ProfileVersionId = z.output<(typeof IdentifierSchemas)['profileVersionId']>
export type SkillId = z.output<(typeof IdentifierSchemas)['skillId']>
export type SkillVersionId = z.output<(typeof IdentifierSchemas)['skillVersionId']>
export type ExecutionId = z.output<(typeof IdentifierSchemas)['executionId']>
export type AttemptId = z.output<(typeof IdentifierSchemas)['attemptId']>
export type WorkflowId = z.output<(typeof IdentifierSchemas)['workflowId']>
export type InteractionId = z.output<(typeof IdentifierSchemas)['interactionId']>
export type RuntimeDefinitionId = z.output<(typeof IdentifierSchemas)['runtimeDefinitionId']>
export type RuntimeNodeRefId = z.output<(typeof IdentifierSchemas)['runtimeNodeRefId']>
export type RuntimeConnectionId = z.output<(typeof IdentifierSchemas)['runtimeConnectionId']>
export type ExternalSessionId = z.output<(typeof IdentifierSchemas)['externalSessionId']>
export type ArtifactId = z.output<(typeof IdentifierSchemas)['artifactId']>
export type EventId = z.output<(typeof IdentifierSchemas)['eventId']>
export type TraceId = z.output<(typeof IdentifierSchemas)['traceId']>
