import { bootstrapService } from '@control-plane/bootstrap'

export const serviceName = 'runtime-gateway'
export const start = () =>
  bootstrapService({
    serviceName,
    start: ({ markReady }) => markReady(),
  })
