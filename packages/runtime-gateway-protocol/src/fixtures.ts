import { GatewayInventoryEnvelopeSchema } from './protocol.js'

const common = {
  type: 'inventory' as const,
  schemaVersion: 1 as const,
  protocolVersion: { major: 1, minor: 0 },
  sequence: 2,
  nodeId: 'rnr_01JABCDEF0123456789ABCDEFG',
  workspaceId: 'wsp_01JABCDEF0123456789ABCDEFG',
  traceId: 'trc_01JABCDEF0123456789ABCDEFG',
  sentAt: '2026-08-25T12:00:00.000Z',
  channelGeneration: 1,
  snapshotVersion: 1,
  observedAt: '2026-08-25T12:00:00.000Z',
  runtimeDrivers: [
    {
      opaqueRef: 'nref_01JABCDEF0123456789ABCDEFG',
      driverFamily: 'reference-runtime',
      driverVersion: '1.0.0',
      harnessVersion: '1.0.0',
      protocolVersion: { major: 1, minor: 0 },
      health: 'healthy' as const,
      capabilities: ['runtime.execute'],
      limitations: [],
    },
  ],
}

const contextProvider = (driverFamily: string, opaqueRef: string) => ({
  opaqueRef,
  driverFamily,
  driverVersion: '1.0.0',
  protocolVersion: { major: 1, minor: 0 },
  health: 'healthy' as const,
  capabilities: ['context.status', 'context.read'],
  limitations: [],
})

export const inventoryFixtures = Object.freeze({
  noProvider: GatewayInventoryEnvelopeSchema.parse({ ...common, contextProviders: [] }),
  cortanaCompatible: GatewayInventoryEnvelopeSchema.parse({
    ...common,
    snapshotVersion: 2,
    contextProviders: [contextProvider('local-context', 'pvr_01JABCDEF0123456789ABCDEFG')],
  }),
  alternateProvider: GatewayInventoryEnvelopeSchema.parse({
    ...common,
    snapshotVersion: 3,
    contextProviders: [contextProvider('alternate-context', 'pvr_01JBBCDEF0123456789ABCDEFG')],
  }),
})
