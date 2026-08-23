import { bootstrapService } from '@control-plane/bootstrap'

export const serviceName = 'control-api'
export const start = () =>
  bootstrapService({
    serviceName,
    start: ({ markReady }) => markReady(),
  })
