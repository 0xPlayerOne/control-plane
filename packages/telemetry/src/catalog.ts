export const executionTraceSpans = [
  'execution.root',
  'plan.compile',
  'workflow.run',
  'runtime.route',
  'runtime.start',
  'graph.run',
  'graph.node',
  'model.call',
  'tool.authorize',
  'tool.execute',
  'sandbox.execute',
  'approval.wait',
  'artifact.promote',
  'usage.settle',
  'execution.cleanup',
] as const

export const operationalMetrics = [
  'control.api.request.duration',
  'control.api.error.count',
  'workflow.backlog.count',
  'workflow.replay.count',
  'runtime.available.count',
  'runtime.gateway.connection.count',
  'runtime.gateway.ack.duration',
  'model.call.duration',
  'model.call.error.count',
  'tool.call.duration',
  'tool.call.error.count',
  'execution.reconciliation.count',
  'execution.manual_intervention.count',
  'usage.cost.usd',
] as const

export type ExecutionTraceSpanName = (typeof executionTraceSpans)[number]
export type OperationalMetricName = (typeof operationalMetrics)[number]
