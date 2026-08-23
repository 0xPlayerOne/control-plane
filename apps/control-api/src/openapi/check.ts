import { createControlApiApplication, createOpenApiDocument } from '../application.js'

const metadata = {
  serviceName: 'control-api' as const,
  version: 'openapi',
  commitSha: 'openapi',
  environment: 'test' as const,
  instanceId: 'openapi',
}
const application = await createControlApiApplication({
  health: () => ({ status: 'ok', metadata }),
  logger: { write: () => undefined },
  metadata,
  readiness: () => ({ status: 'ready', metadata }),
})
try {
  const document = createOpenApiDocument(application)
  if (!document.paths['/v1/system/echo']) throw new Error('Versioned representative path missing')
  if (!document.paths['/health'] || !document.paths['/ready']) {
    throw new Error('Health or readiness path missing')
  }
} finally {
  await application.close()
}
