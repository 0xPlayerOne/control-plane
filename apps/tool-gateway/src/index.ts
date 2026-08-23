import { bootstrapService } from '@control-plane/bootstrap'

export const serviceName = 'tool-gateway'
export const start = () =>
  bootstrapService({
    serviceName,
    start: ({ markReady }) => markReady(),
  })
