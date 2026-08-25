import { createHash } from 'node:crypto'
import { IdentifierSchemas } from '@control-plane/contracts'
import {
  ToolDefinitionSchema,
  ToolExecutionRequestSchema,
  ToolExecutionResultSchema,
  ToolExecutorReferenceSchema,
  ToolVersionDraftSchema,
  ToolVersionSchema,
  type ToolDefinition,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolExecutor,
  type ToolExecutorType,
  type ToolVersion,
  type ToolVersionDraft,
} from '@control-plane/tool-sdk'
import { Ajv, type ValidateFunction } from 'ajv'

export type ToolRegistryErrorCode =
  | 'DEFINITION_EXISTS'
  | 'DEFINITION_MISSING'
  | 'VERSION_EXISTS'
  | 'VERSION_MISSING'
  | 'SEMANTIC_VERSION_CONFLICT'
  | 'INVALID_SCHEMA'
  | 'SCOPE_DENIED'

export class ToolRegistryError extends Error {
  constructor(readonly code: ToolRegistryErrorCode) {
    super(code)
    this.name = 'ToolRegistryError'
  }
}

export interface ToolRegistryRepository {
  insertDefinition(definition: ToolDefinition): Promise<boolean>
  getDefinition(toolDefinitionId: string): Promise<ToolDefinition | undefined>
  listDefinitions(): Promise<readonly ToolDefinition[]>
  insertVersion(version: ToolVersion): Promise<boolean>
  getVersion(toolVersionId: string): Promise<ToolVersion | undefined>
  listVersions(toolDefinitionId: string): Promise<readonly ToolVersion[]>
}

export class InMemoryToolRegistryRepository implements ToolRegistryRepository {
  readonly #definitions = new Map<string, ToolDefinition>()
  readonly #versions = new Map<string, ToolVersion>()

  async insertDefinition(definition: ToolDefinition): Promise<boolean> {
    if (this.#definitions.has(definition.toolDefinitionId)) return false
    this.#definitions.set(definition.toolDefinitionId, clone(definition))
    return true
  }

  async getDefinition(toolDefinitionId: string): Promise<ToolDefinition | undefined> {
    return cloneOptional(this.#definitions.get(toolDefinitionId))
  }

  async listDefinitions(): Promise<readonly ToolDefinition[]> {
    return [...this.#definitions.values()].map(clone)
  }

  async insertVersion(version: ToolVersion): Promise<boolean> {
    if (this.#versions.has(version.toolVersionId)) return false
    this.#versions.set(version.toolVersionId, clone(version))
    return true
  }

  async getVersion(toolVersionId: string): Promise<ToolVersion | undefined> {
    return cloneOptional(this.#versions.get(toolVersionId))
  }

  async listVersions(toolDefinitionId: string): Promise<readonly ToolVersion[]> {
    return [...this.#versions.values()]
      .filter((version) => version.toolDefinitionId === toolDefinitionId)
      .map(clone)
  }
}

export class ToolRegistry {
  readonly #ajv = new Ajv({ allErrors: true, strict: true })

  constructor(readonly repository: ToolRegistryRepository) {}

  async createDefinition(input: unknown): Promise<ToolDefinition> {
    const definition = ToolDefinitionSchema.parse(input)
    if (!(await this.repository.insertDefinition(definition))) failRegistry('DEFINITION_EXISTS')
    return clone(definition)
  }

  async publishVersion(input: ToolVersionDraft): Promise<ToolVersion> {
    const draft = ToolVersionDraftSchema.parse(input)
    const definition = await this.repository.getDefinition(draft.toolDefinitionId)
    if (!definition) failRegistry('DEFINITION_MISSING')
    this.#assertSchema(draft.inputSchema)
    this.#assertSchema(draft.outputSchema)
    const versions = await this.repository.listVersions(draft.toolDefinitionId)
    if (versions.some(({ semanticVersion }) => semanticVersion === draft.semanticVersion)) {
      failRegistry('SEMANTIC_VERSION_CONFLICT')
    }
    const version = ToolVersionSchema.parse({
      ...draft,
      revision: 1,
      lifecycle: 'published',
      contentDigest: digest(draft),
    })
    if (!(await this.repository.insertVersion(version))) failRegistry('VERSION_EXISTS')
    return clone(version)
  }

  async readDefinition(toolDefinitionId: string, workspaceId: string): Promise<ToolDefinition> {
    const definitionId = IdentifierSchemas.toolDefinitionId.parse(toolDefinitionId)
    const scope = IdentifierSchemas.workspaceId.parse(workspaceId)
    const definition = await this.repository.getDefinition(definitionId)
    if (!definition) failRegistry('DEFINITION_MISSING')
    assertScope(definition, scope)
    return clone(definition)
  }

  async readVersion(toolVersionId: string, workspaceId: string): Promise<ToolVersion> {
    const versionId = IdentifierSchemas.toolVersionId.parse(toolVersionId)
    const version = await this.repository.getVersion(versionId)
    if (!version) failRegistry('VERSION_MISSING')
    await this.readDefinition(version.toolDefinitionId, workspaceId)
    return clone(version)
  }

  async resolve(name: string, semanticVersion: string, workspaceId: string): Promise<ToolVersion> {
    const definitions = await this.repository.listDefinitions()
    const definition = definitions.find(({ name: candidate }) => candidate === name)
    if (!definition) failRegistry('DEFINITION_MISSING')
    assertScope(definition, IdentifierSchemas.workspaceId.parse(workspaceId))
    const versions = await this.repository.listVersions(definition.toolDefinitionId)
    const version = versions.find(
      (candidate) =>
        candidate.semanticVersion === semanticVersion &&
        (candidate.lifecycle === 'published' || candidate.lifecycle === 'deprecated')
    )
    if (!version) failRegistry('VERSION_MISSING')
    return clone(version)
  }

  async list(workspaceId: string): Promise<readonly ToolRegistryEntry[]> {
    const scope = IdentifierSchemas.workspaceId.parse(workspaceId)
    const definitions = (await this.repository.listDefinitions())
      .filter((definition) => hasScope(definition, scope))
      .sort((left, right) => left.name.localeCompare(right.name))
    return Promise.all(
      definitions.map(async (definition) => ({
        definition: clone(definition),
        versions: (await this.repository.listVersions(definition.toolDefinitionId))
          .filter(({ lifecycle }) => lifecycle !== 'revoked')
          .sort((left, right) => left.semanticVersion.localeCompare(right.semanticVersion))
          .map(clone),
      }))
    )
  }

  #assertSchema(schema: Record<string, unknown>): void {
    if (
      Buffer.byteLength(JSON.stringify(schema), 'utf8') > 262_144 ||
      containsSensitiveProperty(schema)
    ) {
      failRegistry('INVALID_SCHEMA')
    }
    try {
      this.#ajv.compile(schema)
    } catch {
      failRegistry('INVALID_SCHEMA')
    }
  }
}

const sensitivePropertyName =
  /^(?:api[_-]?key|access[_-]?token|authorization|cookie|credential|password|private[_-]?key|refresh[_-]?token|secret)$/i

function containsSensitiveProperty(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveProperty)
  if (value === null || typeof value !== 'object') return false
  for (const [key, entry] of Object.entries(value)) {
    if (
      (key === 'properties' || key === 'patternProperties') &&
      entry !== null &&
      typeof entry === 'object' &&
      Object.keys(entry).some((property) => sensitivePropertyName.test(property))
    ) {
      return true
    }
    if (containsSensitiveProperty(entry)) return true
  }
  return false
}

export interface ToolRegistryEntry {
  readonly definition: ToolDefinition
  readonly versions: readonly ToolVersion[]
}

export type ToolGatewayErrorCode =
  | 'TOOL_UNAVAILABLE'
  | 'GRANT_DENIED'
  | 'OPERATION_UNAVAILABLE'
  | 'EXECUTOR_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'INPUT_LIMIT_EXCEEDED'
  | 'INVALID_OUTPUT'
  | 'OUTPUT_LIMIT_EXCEEDED'

export class ToolGatewayError extends Error {
  constructor(readonly code: ToolGatewayErrorCode) {
    super(code)
    this.name = 'ToolGatewayError'
  }
}

export class ToolGateway {
  readonly #ajv = new Ajv({ allErrors: true, strict: true })
  readonly #executors = new Map<string, ToolExecutor>()
  readonly #inputValidators = new Map<string, ValidateFunction>()
  readonly #outputValidators = new Map<string, ValidateFunction>()

  constructor(readonly registry: ToolRegistry) {}

  registerExecutor(type: ToolExecutorType, reference: string, executor: ToolExecutor): void {
    const parsed = ToolExecutorReferenceSchema.parse({ type, reference })
    this.#executors.set(executorKey(parsed.type, parsed.reference), executor)
  }

  async execute(input: unknown): Promise<ToolExecutionResult> {
    const request = ToolExecutionRequestSchema.parse(input)
    assertGrant(request)
    let version: ToolVersion
    try {
      version = await this.registry.readVersion(request.toolVersionId, request.workspaceId)
    } catch {
      failGateway('TOOL_UNAVAILABLE')
    }
    if (version.toolDefinitionId !== request.toolDefinitionId) failGateway('TOOL_UNAVAILABLE')
    if (version.lifecycle !== 'published' && version.lifecycle !== 'deprecated') {
      failGateway('TOOL_UNAVAILABLE')
    }
    if (!version.operations.some(({ name }) => name === request.operation)) {
      failGateway('OPERATION_UNAVAILABLE')
    }
    assertSize(request.input, version.limits.maxInputBytes, 'INPUT_LIMIT_EXCEEDED')
    const validateInput = this.#validator(this.#inputValidators, version, 'input')
    if (!validateInput(request.input)) failGateway('INVALID_INPUT')
    const executor = this.#executors.get(
      executorKey(version.executor.type, version.executor.reference)
    )
    if (!executor) failGateway('EXECUTOR_UNAVAILABLE')
    const result = await executor.execute(request, version)
    assertSize(result.output, version.limits.maxOutputBytes, 'OUTPUT_LIMIT_EXCEEDED')
    const validateOutput = this.#validator(this.#outputValidators, version, 'output')
    if (!validateOutput(result.output)) failGateway('INVALID_OUTPUT')
    return ToolExecutionResultSchema.parse({
      toolDefinitionId: version.toolDefinitionId,
      toolVersionId: version.toolVersionId,
      operation: request.operation,
      output: result.output,
      artifactRefs: result.artifactRefs ?? [],
      executor: version.executor,
      audit: {
        ...request.audit,
        contentDigest: digest({
          requestId: request.requestId,
          toolVersionId: request.toolVersionId,
          operation: request.operation,
          input: request.input,
          output: result.output,
        }),
      },
    })
  }

  #validator(
    cache: Map<string, ValidateFunction>,
    version: ToolVersion,
    direction: 'input' | 'output'
  ): ValidateFunction {
    const current = cache.get(version.toolVersionId)
    if (current) return current
    const validator = this.#ajv.compile(
      direction === 'input' ? version.inputSchema : version.outputSchema
    )
    cache.set(version.toolVersionId, validator)
    return validator
  }
}

export class FakeToolExecutor implements ToolExecutor {
  readonly requests: ToolExecutionRequest[] = []

  constructor(readonly respond: (request: ToolExecutionRequest, version: ToolVersion) => unknown) {}

  async execute(request: ToolExecutionRequest, version: ToolVersion) {
    this.requests.push(clone(request))
    return { output: this.respond(request, version) }
  }
}

function assertGrant(request: ToolExecutionRequest): void {
  const grant = request.grant
  if (
    grant.workspaceId !== request.workspaceId ||
    grant.profileId !== request.profileId ||
    grant.toolDefinitionId !== request.toolDefinitionId ||
    grant.toolVersionId !== request.toolVersionId ||
    !grant.operations.includes(request.operation) ||
    (grant.expiresAt !== undefined && Date.parse(grant.expiresAt) <= Date.now())
  ) {
    failGateway('GRANT_DENIED')
  }
}

function assertScope(definition: ToolDefinition, workspaceId: string): void {
  if (!hasScope(definition, workspaceId)) failRegistry('SCOPE_DENIED')
}

function hasScope(definition: ToolDefinition, workspaceId: string): boolean {
  return definition.ownership.scope === 'system' || definition.ownership.workspaceId === workspaceId
}

function assertSize(value: unknown, limit: number, code: ToolGatewayErrorCode): void {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > limit) failGateway(code)
}

function executorKey(type: ToolExecutorType, reference: string): string {
  return `${type}:${reference}`
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`
}

function canonical(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function clone<Value>(value: Value): Value {
  return structuredClone(value)
}

function cloneOptional<Value>(value: Value | undefined): Value | undefined {
  return value === undefined ? undefined : clone(value)
}

function failRegistry(code: ToolRegistryErrorCode): never {
  throw new ToolRegistryError(code)
}

function failGateway(code: ToolGatewayErrorCode): never {
  throw new ToolGatewayError(code)
}
