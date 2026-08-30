import type {
  RuntimeAdapter,
  RuntimeAdapterInspection,
  RuntimeApprovalRequest,
  RuntimeCancelRequest,
  RuntimeExecutionHandle,
  RuntimeExecutionProgress,
  RuntimeExecutionStatus,
  RuntimeInputRequest,
  RuntimeProgressOptions,
  RuntimeSessionOperation,
  RuntimeSessionResult,
  RuntimeStartRequest,
} from './adapter.js'
import { RuntimeAdapterInspectionSchema } from './adapter.js'

export type RuntimeTransportKind = 'direct-local' | 'remote-gateway'

/**
 * Concrete runtime operations at the location where a harness executes.
 * Drivers do not decide whether their caller is co-located or remote.
 */
export type RuntimeDriver = RuntimeAdapter

/**
 * Selects how normalized RuntimeAdapter operations reach a RuntimeDriver.
 * Transport choice is topology metadata and never changes semantic payloads.
 */
export interface RuntimeTransport extends RuntimeAdapter {
  readonly kind: RuntimeTransportKind
}

export interface RuntimeAdapterWithTransport extends RuntimeAdapter {
  readonly transportKind: RuntimeTransportKind
}

abstract class DelegatingRuntimeAdapter implements RuntimeAdapter {
  constructor(protected readonly driver: RuntimeDriver) {}

  inspect(
    requirements?: Parameters<RuntimeAdapter['inspect']>[0]
  ): Promise<RuntimeAdapterInspection> {
    return this.driver.inspect(requirements)
  }

  start(request: RuntimeStartRequest): Promise<RuntimeExecutionHandle> {
    return this.driver.start(request)
  }

  progress(
    handle: RuntimeExecutionHandle,
    options?: RuntimeProgressOptions
  ): AsyncIterable<RuntimeExecutionProgress> {
    return this.driver.progress(handle, options)
  }

  submitInput(
    handle: RuntimeExecutionHandle,
    request: RuntimeInputRequest
  ): Promise<RuntimeExecutionStatus> {
    return this.driver.submitInput(handle, request)
  }

  submitApproval(
    handle: RuntimeExecutionHandle,
    request: RuntimeApprovalRequest
  ): Promise<RuntimeExecutionStatus> {
    return this.driver.submitApproval(handle, request)
  }

  cancel(
    handle: RuntimeExecutionHandle,
    request: RuntimeCancelRequest
  ): Promise<RuntimeExecutionStatus> {
    return this.driver.cancel(handle, request)
  }

  status(handle: RuntimeExecutionHandle): Promise<RuntimeExecutionStatus> {
    return this.driver.status(handle)
  }

  reconcile(handle: RuntimeExecutionHandle): Promise<RuntimeExecutionStatus> {
    return this.driver.reconcile(handle)
  }

  session(operation: RuntimeSessionOperation): Promise<RuntimeSessionResult> {
    return this.driver.session(operation)
  }

  cleanup(handle: RuntimeExecutionHandle): Promise<void> {
    return this.driver.cleanup(handle)
  }
}

abstract class DelegatingRuntimeTransport
  extends DelegatingRuntimeAdapter
  implements RuntimeTransport
{
  abstract readonly kind: RuntimeTransportKind
}

/** Adapter-side facade that records topology while preserving the driver's semantic surface. */
export class TransportedRuntimeAdapter
  extends DelegatingRuntimeAdapter
  implements RuntimeAdapterWithTransport
{
  readonly transportKind: RuntimeTransportKind

  constructor(
    protected readonly transport: RuntimeTransport,
    readonly expectedAdapterName: string
  ) {
    super(transport)
    this.transportKind = transport.kind
  }

  override async inspect(
    requirements?: Parameters<RuntimeAdapter['inspect']>[0]
  ): Promise<RuntimeAdapterInspection> {
    const inspection = RuntimeAdapterInspectionSchema.parse(
      await this.transport.inspect(requirements)
    )
    if (inspection.metadata.adapterName !== this.expectedAdapterName) {
      throw new Error('RUNTIME_TRANSPORT_DRIVER_FAMILY_MISMATCH')
    }
    return RuntimeAdapterInspectionSchema.parse({
      ...inspection,
      metadata: { ...inspection.metadata, transportKind: this.transportKind },
    })
  }
}

/** In-process/IPC-free transport for a co-located Local or Hosted runtime driver. */
export class DirectLocalRuntimeTransport extends DelegatingRuntimeTransport {
  readonly kind = 'direct-local' as const
}

/**
 * Semantic wrapper for a driver proxy backed by the authenticated Runtime Gateway.
 * Wire delivery, reconnect, and command-ledger behavior remain in the proxy driver.
 */
export class RemoteRuntimeGatewayTransport extends DelegatingRuntimeTransport {
  readonly kind = 'remote-gateway' as const
}
