import { randomUUID } from 'node:crypto'
import type { RuntimeNodeChannel } from './authentication.js'
import type {
  RuntimeGatewayWebSocketLifecycle,
  RuntimeGatewaySocket,
} from './websocket-lifecycle.js'

interface WebSocketUpgradeData {
  readonly connectionId: string
  readonly authenticatedChannel: RuntimeNodeChannel
}

interface NativeServerSocket {
  readonly data: WebSocketUpgradeData
  getBufferedAmount(): number
  send(value: string): unknown
  close(code: number, reason: string): void
}

interface NativeUpgradeServer {
  upgrade(request: Request, options: { readonly data: WebSocketUpgradeData }): boolean
}

interface NativeServeOptions {
  readonly hostname: string
  readonly port: number
  readonly fetch: (request: Request, server: NativeUpgradeServer) => Promise<Response | undefined>
  readonly websocket: {
    readonly maxPayloadLength: number
    readonly backpressureLimit: number
    readonly closeOnBackpressureLimit: true
    readonly idleTimeout: number
    readonly open: (socket: NativeServerSocket) => void
    readonly message: (
      socket: NativeServerSocket,
      message: string | ArrayBuffer | Uint8Array
    ) => Promise<void>
    readonly close: (socket: NativeServerSocket, code: number, reason: string) => Promise<void>
  }
}

interface NativeGatewayServer {
  stop(closeActiveConnections?: boolean): void | Promise<void>
}

export type RuntimeGatewayNativeServe = (options: NativeServeOptions) => NativeGatewayServer

export interface RuntimeGatewayWebSocketServerOptions {
  readonly lifecycle: RuntimeGatewayWebSocketLifecycle
  readonly authenticateUpgrade: (request: Request) => Promise<RuntimeNodeChannel>
  readonly hostname: string
  readonly port: number
  readonly limits: {
    readonly maxFrameBytes: number
    readonly maxBufferedBytes: number
    readonly idleTimeoutSeconds: number
  }
  readonly serve?: RuntimeGatewayNativeServe
}

export class RuntimeGatewayWebSocketServer {
  readonly #authenticateUpgrade: (request: Request) => Promise<RuntimeNodeChannel>
  readonly #hostname: string
  readonly #idleTimeoutSeconds: number
  readonly #lifecycle: RuntimeGatewayWebSocketLifecycle
  readonly #maxBufferedBytes: number
  readonly #maxFrameBytes: number
  readonly #port: number
  readonly #serve: RuntimeGatewayNativeServe
  #server: NativeGatewayServer | undefined

  constructor(options: RuntimeGatewayWebSocketServerOptions) {
    this.#lifecycle = options.lifecycle
    this.#authenticateUpgrade = options.authenticateUpgrade
    this.#hostname = options.hostname
    this.#port = options.port
    this.#maxFrameBytes = positiveInteger(options.limits.maxFrameBytes, 'maxFrameBytes')
    this.#maxBufferedBytes = positiveInteger(options.limits.maxBufferedBytes, 'maxBufferedBytes')
    this.#idleTimeoutSeconds = positiveInteger(
      options.limits.idleTimeoutSeconds,
      'idleTimeoutSeconds'
    )
    this.#serve = options.serve ?? nativeBunServe
  }

  start(): void {
    if (this.#server !== undefined) throw new Error('Runtime Gateway server is already started')
    this.#server = this.#serve({
      hostname: this.#hostname,
      port: this.#port,
      fetch: (request, server) => this.#upgrade(request, server),
      websocket: {
        maxPayloadLength: this.#maxFrameBytes,
        backpressureLimit: this.#maxBufferedBytes,
        closeOnBackpressureLimit: true,
        idleTimeout: this.#idleTimeoutSeconds,
        open: (socket) => {
          this.#lifecycle.open({
            ...socket.data,
            socket: nativeSocketAdapter(socket),
          })
        },
        message: (socket, message) => this.#lifecycle.receive(socket.data.connectionId, message),
        close: (socket, code, reason) =>
          this.#lifecycle.closed(
            socket.data.connectionId,
            `peer_closed_${code}_${normalizeReason(reason)}`
          ),
      },
    })
  }

  async close(): Promise<void> {
    const server = this.#server
    if (server === undefined) return
    this.#server = undefined
    await this.#lifecycle.close()
    await server.stop(false)
  }

  async #upgrade(request: Request, server: NativeUpgradeServer): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.pathname !== '/runtime-gateway/v1/connect') {
      return new Response('Not Found', { status: 404 })
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    let authenticatedChannel: RuntimeNodeChannel
    try {
      authenticatedChannel = await this.#authenticateUpgrade(request)
    } catch {
      return new Response('RuntimeNode authentication rejected', { status: 401 })
    }
    const upgraded = server.upgrade(request, {
      data: { connectionId: `gwc_${randomUUID()}`, authenticatedChannel },
    })
    return upgraded ? undefined : new Response('WebSocket upgrade unavailable', { status: 503 })
  }
}

function nativeSocketAdapter(socket: NativeServerSocket): RuntimeGatewaySocket {
  return {
    bufferedAmount: () => socket.getBufferedAmount(),
    send: (value) => {
      socket.send(value)
    },
    close: (code, reason) => socket.close(code, reason),
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`)
  return value
}

function normalizeReason(reason: string): string {
  const normalized = reason.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  return normalized.length === 0 ? 'none' : normalized
}

function nativeBunServe(options: NativeServeOptions): NativeGatewayServer {
  const runtime = (globalThis as unknown as { readonly Bun?: { serve: RuntimeGatewayNativeServe } })
    .Bun
  if (runtime === undefined) throw new Error('Runtime Gateway WebSocket server requires Bun')
  return runtime.serve(options)
}
