import { bootstrapService, type ServiceStartOptions } from '@control-plane/bootstrap'

export const serviceName = 'tool-gateway'
export const start = (options: ServiceStartOptions = {}) =>
  bootstrapService({
    ...options,
    serviceName,
    start: ({ markReady }) => markReady(),
  })
