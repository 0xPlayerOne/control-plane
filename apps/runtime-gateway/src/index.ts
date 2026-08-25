import { bootstrapService, type ServiceStartOptions } from '@control-plane/bootstrap'

export * from './authentication.js'

export const serviceName = 'runtime-gateway'
export const start = (options: ServiceStartOptions = {}) =>
  bootstrapService({
    ...options,
    serviceName,
    start: ({ markReady }) => markReady(),
  })
