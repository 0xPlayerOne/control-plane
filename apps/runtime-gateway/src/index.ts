import { bootstrapService, type ServiceStartOptions } from '@control-plane/bootstrap'
import type { RuntimeGatewayWebSocketServer } from './websocket-server.js'

export * from './authentication.js'
export * from './runtime-command-delivery.js'
export * from './runtime-event-ingestion.js'
export * from './runtime-inventory-ingestion.js'
export * from './websocket-lifecycle.js'

export const serviceName = 'runtime-gateway'
export interface RuntimeGatewayStartOptions extends ServiceStartOptions {
  readonly webSocketServer?: RuntimeGatewayWebSocketServer
}

export const start = ({ webSocketServer, ...options }: RuntimeGatewayStartOptions = {}) =>
  bootstrapService({
    ...options,
    serviceName,
    start: ({ markReady, registerResource }) => {
      if (webSocketServer !== undefined) {
        webSocketServer.start()
        registerResource('runtime-gateway-websocket', () => webSocketServer.close())
      }
      markReady()
    },
  })
