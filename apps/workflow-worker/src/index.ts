import { bootstrapService } from '@control-plane/bootstrap'

export const serviceName = 'workflow-worker'
export const start = () =>
  bootstrapService({
    serviceName,
    start: ({ markReady }) => markReady(),
  })
