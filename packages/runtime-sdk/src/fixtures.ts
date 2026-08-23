import { RuntimeDefinitionSchema, type RuntimeDefinition } from './models.js'

const testedVersions = {
  contractVersion: { major: 1, minor: 0 },
  adapterVersion: '1.0.0',
  driverVersion: '1.0.0',
  harnessVersion: '1.0.0',
} as const

export const RuntimeFixtures = Object.freeze({
  mock: runtime('rtd_01JABCDEF0123456789ABCDEFG', 'mock', [
    capability('stream.output'),
    capability('output.structured'),
    capability('session.create'),
  ]),
  futurePi: runtime('rtd_01JBBCDEF0123456789ABCDEFG', 'pi', [
    capability('stream.output'),
    capability('tool.call'),
    capability('session.create'),
    capability('session.list'),
    capability('session.resume'),
    capability('session.close'),
    capability('session.history', 'degraded', ['History may be truncated']),
  ]),
  futureAcp: runtime('rtd_01JZBCDEF0123456789ABCDEFG', 'acp', [
    capability('stream.output'),
    capability('tool.call'),
    capability('session.list'),
    capability('session.resume'),
    capability('session.load'),
  ]),
})

function runtime(
  runtimeDefinitionId: string,
  family: string,
  capabilities: RuntimeDefinition['capabilities']
): RuntimeDefinition {
  return RuntimeDefinitionSchema.parse({
    runtimeDefinitionId,
    family,
    adapterVersion: '1.0.0',
    driverVersion: '1.0.0',
    harnessVersion: '1.0.0',
    location: 'local_device',
    health: 'healthy',
    lifecycle: 'active',
    capabilities,
    compatibility: { status: 'tested', testedVersions, limitations: [] },
  })
}

function capability(
  name: RuntimeDefinition['capabilities'][number]['name'],
  support: RuntimeDefinition['capabilities'][number]['support'] = 'supported',
  limitations?: readonly string[]
) {
  return { name, support, ...(limitations === undefined ? {} : { limitations: [...limitations] }) }
}
