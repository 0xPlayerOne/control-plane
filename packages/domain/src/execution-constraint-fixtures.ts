import {
  ExecutionConstraintSetSchema,
  type ExecutionConstraintSet,
} from './execution-constraints.js'

const digest = `sha256:${'a'.repeat(64)}`
const common = {
  schemaVersion: 1 as const,
  context: {
    allowedClassifications: ['public', 'internal'] as const,
    maximumItems: 100,
    maximumBytes: 1_000_000,
  },
  models: [
    {
      alias: 'reasoning.standard',
      requiredCapabilities: ['tool_calling', 'structured_output'] as const,
      providerPolicy: {
        allowedClasses: ['managed', 'local'] as const,
        deniedProviders: [] as const,
        dataResidency: ['us'] as const,
      },
      fallback: 'same_capabilities' as const,
    },
  ],
  runtime: {
    allowedFamilies: ['mock', 'pi', 'acp'] as const,
    allowedLocations: ['local', 'remote'] as const,
    requiredCapabilities: ['stream.output'] as const,
  },
  limits: {
    budget: { currency: 'USD' as const, maximumMicrounits: 10_000_000 },
    tokens: { maximumTotal: 250_000 },
    duration: { maximumMs: 1_800_000 },
    concurrency: { maximumParallel: 8 },
    childExecutions: { maximumTotal: 20, maximumDepth: 3 },
    sandbox: { cpuMillicores: 4_000, memoryMebibytes: 8_192, storageMebibytes: 16_384 },
  },
  interaction: {
    approvals: 'allowed' as const,
    userInput: 'allowed' as const,
    destructiveOperations: 'require_approval' as const,
    approvalExpiryMs: 900_000,
  },
  policySnapshot: { policyId: 'workspace-standard', version: 3, digest },
}

const tool = (
  operations: readonly string[],
  riskClass: 'safe' | 'read' | 'write' | 'destructive' | 'privileged',
  approval: 'none' | 'per_execution' | 'per_operation' | 'always'
) => ({
  default: 'deny' as const,
  grants: [
    { tool: { toolId: 'project-files', versionRange: '^1.0.0' }, operations, riskClass, approval },
  ],
})

const fixture = (value: unknown): ExecutionConstraintSet =>
  ExecutionConstraintSetSchema.parse(value)

export const executionConstraintFixtures = {
  safe: fixture({ ...common, tools: tool(['inspect'], 'safe', 'none') }),
  readOnly: fixture({ ...common, tools: tool(['read'], 'read', 'none') }),
  write: fixture({ ...common, tools: tool(['read', 'write'], 'write', 'per_operation') }),
  privileged: fixture({
    ...common,
    tools: tool(['admin'], 'privileged', 'always'),
    interaction: { ...common.interaction, approvals: 'required' },
  }),
  budgetConstrained: fixture({
    ...common,
    tools: tool(['read', 'write'], 'write', 'per_operation'),
    limits: {
      budget: { currency: 'USD', maximumMicrounits: 2_000_000 },
      tokens: { maximumTotal: 50_000 },
      duration: { maximumMs: 300_000 },
      concurrency: { maximumParallel: 2 },
      childExecutions: { maximumTotal: 3, maximumDepth: 1 },
      sandbox: { cpuMillicores: 1_000, memoryMebibytes: 2_048, storageMebibytes: 4_096 },
    },
  }),
} as const
