import { bootstrapService, type ServiceStartOptions } from '@control-plane/bootstrap'

export const serviceName = 'runtime-worker'
export const start = (options: ServiceStartOptions = {}) =>
  bootstrapService({
    ...options,
    serviceName,
    start: ({ markReady }) => markReady(),
  })
