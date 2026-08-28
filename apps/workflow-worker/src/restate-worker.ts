import http from 'node:http'
import * as restate from '@restatedev/restate-sdk'
import {
  runExecutionLifecycle,
  type ExecutionLifecycleActivities,
  type ExecutionWorkflowInput,
  type ExecutionWorkflowResult,
  type WorkflowInteractionResponse,
} from './execution-workflow.js'

export const restateWorkflowName = 'execution-lifecycle'
export const restatePort = 9080
const terminalControlPromiseName = 'terminal-control'

export interface RestateEndpointHandle {
  readonly run: () => Promise<void>
  readonly shutdown: () => Promise<void>
}

export interface RestateEndpointFactory {
  create(): Promise<RestateEndpointHandle>
}

const unavailable = async (): Promise<never> => {
  throw new Error('EXECUTION_ACTIVITY_PORT_NOT_CONFIGURED')
}

const defaultActivities: ExecutionLifecycleActivities = {
  ensureAttempt: unavailable,
  persistStatus: unavailable,
  dispatch: unavailable,
  applyInteraction: unavailable,
  runGraphSegment: unavailable,
  resumeGraphSegment: unavailable,
  continueGraphSegment: unavailable,
  cleanup: unavailable,
}

const interactionPromiseName = (interactionId: string) => `interaction:${interactionId}`

export function createRestateWorkflowDefinition(
  activities: ExecutionLifecycleActivities = defaultActivities
) {
  return restate.workflow({
    name: restateWorkflowName,
    handlers: {
      run: async (
        ctx: restate.WorkflowContext,
        input: ExecutionWorkflowInput
      ): Promise<ExecutionWorkflowResult> =>
        runRestateExecution(ctx, input, activities),
      respondToInteraction: async (
        ctx: restate.WorkflowSharedContext,
        response: WorkflowInteractionResponse
      ): Promise<void> => {
        await ctx.promise<WorkflowInteractionResponse>(
          interactionPromiseName(response.interactionId)
        ).resolve(response)
      },
      cancelExecution: async (ctx: restate.WorkflowSharedContext): Promise<void> => {
        await ctx.promise<TerminalControl>(terminalControlPromiseName).resolve({ cancelled: true })
      },
    },
  })
}

type TerminalControl = { readonly cancelled: true } | { readonly deadlineReached: true }

async function runRestateExecution(
  ctx: restate.WorkflowContext,
  input: ExecutionWorkflowInput,
  activities: ExecutionLifecycleActivities
): Promise<ExecutionWorkflowResult> {
  const deadlineDelay = Math.max(0, Date.parse(input.deadlineAt) - (await ctx.date.now()))
  const terminalControl = ctx.promise<TerminalControl>(terminalControlPromiseName)
  const waitForInteraction = async (interactionId: string): Promise<WorkflowInteractionResponse> => {
    const outcome = await restate.RestatePromise.race([
      ctx.promise<WorkflowInteractionResponse>(interactionPromiseName(interactionId)).get(),
      terminalControl.get(),
      ctx.sleep(deadlineDelay, 'execution-deadline').map(() => ({ deadlineReached: true } as const)),
    ])
    if ('cancelled' in outcome) throw new RestateTerminalControlError({ cancelled: true })
    if ('deadlineReached' in outcome) throw new RestateTerminalControlError({ deadlineReached: true })
    return outcome
  }
  try {
    return await runExecutionLifecycle(input, createDurableActivities(ctx, activities), {
      waitForInteraction,
    })
  } catch (error) {
    if (!(error instanceof RestateTerminalControlError)) throw error
    return runExecutionLifecycle(input, createDurableActivities(ctx, activities), error.control)
  }
}

class RestateTerminalControlError extends Error {
  constructor(readonly control: TerminalControl) {
    super('WORKFLOW_TERMINAL_CONTROL')
  }
}

function createDurableActivities(
  ctx: restate.WorkflowContext,
  activities: ExecutionLifecycleActivities
): ExecutionLifecycleActivities {
  return {
    ensureAttempt: (input) => ctx.run('ensure-attempt', () => activities.ensureAttempt(input)),
    persistStatus: (input) => ctx.run('persist-status', () => activities.persistStatus(input)),
    dispatch: (input) => ctx.run('dispatch', () => activities.dispatch(input)),
    applyInteraction: (input) => ctx.run('apply-interaction', () => activities.applyInteraction(input)),
    runGraphSegment: (input) => ctx.run('run-graph-segment', () => activities.runGraphSegment(input)),
    resumeGraphSegment: (input) => ctx.run('resume-graph-segment', () => activities.resumeGraphSegment(input)),
    continueGraphSegment: (input) => ctx.run('continue-graph-segment', () => activities.continueGraphSegment(input)),
    cleanup: (input) => ctx.run('cleanup', () => activities.cleanup(input)),
  }
}

export function createRestateEndpointFactory(options: {
  readonly port?: number
  readonly activities?: ExecutionLifecycleActivities
} = {}): RestateEndpointFactory {
  return {
    async create() {
      const restateHandler = restate.createEndpointHandler({
        services: [createRestateWorkflowDefinition(options.activities)],
        bidirectional: false,
      })
      const server = http.createServer((request, response) => {
        if (request.url === '/health' || request.url === '/ready') {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ status: 'ok', service: 'workflow-worker' }))
          return
        }
        restateHandler(request, response)
      })
      const port = options.port ?? Number(process.env['PORT'] ?? restatePort)
      return {
        run: () =>
          new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(port, '0.0.0.0', () => {
              server.off('error', reject)
              resolve()
            })
          }),
        shutdown: () =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
          }),
      }
    },
  }
}
