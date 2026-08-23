import { bootstrapService } from '@control-plane/bootstrap'

export const serviceName = 'runtime-worker'
export const start = () =>
  bootstrapService({
    serviceName,
    start: ({ markReady }) => markReady(),
  })
