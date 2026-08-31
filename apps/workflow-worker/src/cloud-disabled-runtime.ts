import type { WorkflowRuntimeActivityPort } from './cloud-execution-activities.js'

export const CLOUD_RUNTIME_DISABLED_FAILURE = 'CLOUD_RUNTIME_DISABLED'

export class DisabledCloudRuntime implements WorkflowRuntimeActivityPort {
  async dispatch(): ReturnType<WorkflowRuntimeActivityPort['dispatch']> {
    return disabledOutcome()
  }

  async applyInteraction(): ReturnType<WorkflowRuntimeActivityPort['applyInteraction']> {
    return disabledOutcome()
  }

  async cancel(): Promise<void> {}

  async cleanup(): Promise<void> {}
}

function disabledOutcome() {
  return {
    outcome: 'failed' as const,
    failureCode: CLOUD_RUNTIME_DISABLED_FAILURE,
    retryable: false,
  }
}
