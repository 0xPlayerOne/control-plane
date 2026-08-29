import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const environmentNames = new Set(['staging', 'production'])
const applicationServices = new Set([
  '@control-plane/control-api',
  '@control-plane/workflow-worker',
])
const shutdownOrder = ['@control-plane/control-api', '@control-plane/workflow-worker', 'restate']
const reactivatableDeploymentStatuses = new Set([
  'BUILDING',
  'DEPLOYING',
  'INITIALIZING',
  'NEEDS_APPROVAL',
  'QUEUED',
  'SLEEPING',
  'WAITING',
])

export function planStandbyActions({ environment, services }) {
  if (!environmentNames.has(environment)) {
    throw new Error('Railway standby environment must be staging or production.')
  }
  if (!Array.isArray(services)) {
    throw new Error('Railway service inventory must be an array.')
  }

  const servicesByName = new Map()
  for (const service of services) {
    if (!shutdownOrder.includes(service?.name)) {
      throw new Error(
        `Unexpected Railway service in Cloud environment: ${service?.name ?? '<unknown>'}.`
      )
    }
    if (servicesByName.has(service.name)) {
      throw new Error(`Duplicate Railway service in Cloud environment: ${service.name}.`)
    }
    servicesByName.set(service.name, service)
  }
  const requiredServices =
    environment === 'staging'
      ? shutdownOrder
      : ['@control-plane/control-api', '@control-plane/workflow-worker']
  const missingServices = requiredServices.filter((serviceName) => !servicesByName.has(serviceName))
  if (missingServices.length > 0) {
    throw new Error(`Missing expected Railway services: ${missingServices.join(', ')}.`)
  }

  const actions = []
  for (const serviceName of shutdownOrder) {
    const service = servicesByName.get(serviceName)
    if (service === undefined) continue

    if (applicationServices.has(serviceName) && (service.repoTriggerCount ?? 0) > 0) {
      actions.push({
        type: 'disconnect-source',
        environment,
        serviceId: service.id,
        serviceName,
      })
    }

    const deploymentIds = new Set()
    if (service.deploymentStopped === false || (service.replicas?.running ?? 0) > 0) {
      if (typeof service.deploymentId !== 'string' || service.deploymentId.length === 0) {
        throw new Error(`Running Railway service has no active deployment ID: ${serviceName}.`)
      }
      deploymentIds.add(service.deploymentId)
    }
    for (const deployment of service.deployments ?? []) {
      if (reactivatableDeploymentStatuses.has(deployment.status)) {
        deploymentIds.add(deployment.id)
      }
    }

    for (const deploymentId of deploymentIds) {
      actions.push({
        type: 'remove-deployment',
        deploymentId,
        serviceName,
      })
    }
  }

  return actions
}

function runRailway(arguments_, { tolerateTimeout = false } = {}) {
  try {
    return execFileSync('railway', arguments_, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    })
  } catch (error) {
    if (tolerateTimeout && (error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM')) {
      return undefined
    }
    throw error
  }
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function loadInventory(environment) {
  const services = JSON.parse(
    runRailway(['service', 'list', '--environment', environment, '--json'])
  )
  return services.map((service) => {
    const repoTriggerCount = applicationServices.has(service.name)
      ? JSON.parse(runRailway(railwayRepoTriggersArguments(service.id))).data.service.repoTriggers
          .edges.length
      : 0
    return {
      ...service,
      repoTriggerCount,
      deployments: JSON.parse(
        runRailway([
          'deployment',
          'list',
          '--environment',
          environment,
          '--service',
          service.id,
          '--json',
        ])
      ),
    }
  })
}

function verifyStandby(environment) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const inventory = loadInventory(environment)
    const stillActive = inventory.filter(
      (service) => (service.replicas?.running ?? 0) !== 0 || service.deploymentStopped === false
    )
    const connectedApplications = inventory.filter(
      (service) => applicationServices.has(service.name) && service.repoTriggerCount > 0
    )
    const pendingDeployments = inventory.flatMap((service) =>
      service.deployments.filter(
        (deployment) =>
          reactivatableDeploymentStatuses.has(deployment.status) || deployment.status === 'REMOVING'
      )
    )
    if (
      stillActive.length === 0 &&
      connectedApplications.length === 0 &&
      pendingDeployments.length === 0
    ) {
      return
    }
    wait(3_000)
  }

  throw new Error(
    'Railway standby verification failed: compute, a pending deployment, or an application source remains active.'
  )
}

export function railwayRemoveArguments(deploymentId) {
  return [
    'api',
    '--raw-var',
    `id=${deploymentId}`,
    '--compact',
    'mutation Remove($id: String!) { deploymentRemove(id: $id) }',
  ]
}

export function railwayRepoTriggersArguments(serviceId) {
  return [
    'api',
    '--raw-var',
    `id=${serviceId}`,
    '--compact',
    'query ServiceRepoTriggers($id: String!) { service(id: $id) { repoTriggers { edges { node { id } } } } }',
  ]
}

export function railwayDisconnectArguments(serviceId) {
  return [
    'api',
    '--raw-var',
    `id=${serviceId}`,
    '--compact',
    'mutation Disconnect($id: String!) { serviceDisconnect(id: $id) { id } }',
  ]
}

function disconnectSource(action) {
  const response = JSON.parse(runRailway(railwayDisconnectArguments(action.serviceId)))
  if (response.errors || response.data?.serviceDisconnect?.id !== action.serviceId) {
    throw new Error(`Railway did not disconnect the source for ${action.serviceName}.`)
  }
}

function removeDeployment(action) {
  const output = runRailway(railwayRemoveArguments(action.deploymentId), {
    tolerateTimeout: true,
  })
  if (output === undefined) return

  const response = JSON.parse(output)
  if (response.errors || response.data?.deploymentRemove !== true) {
    throw new Error(`Railway did not remove the active deployment for ${action.serviceName}.`)
  }
}

function parseArguments(arguments_) {
  const environmentIndex = arguments_.indexOf('--environment')
  const confirmIndex = arguments_.indexOf('--confirm')
  return {
    environment: environmentIndex >= 0 ? arguments_[environmentIndex + 1] : undefined,
    apply: arguments_.includes('--apply'),
    confirm: confirmIndex >= 0 ? arguments_[confirmIndex + 1] : undefined,
  }
}

export function main(arguments_ = process.argv.slice(2)) {
  const options = parseArguments(arguments_)
  if (!environmentNames.has(options.environment)) {
    throw new Error(
      'Usage: railway-standby --environment <staging|production> [--apply --confirm <environment>]'
    )
  }
  if (options.apply && options.confirm !== options.environment) {
    throw new Error('Applying standby requires --confirm to exactly match the environment.')
  }

  const inventory = loadInventory(options.environment)
  const actions = planStandbyActions({ environment: options.environment, services: inventory })

  if (options.apply) {
    for (const action of actions) {
      if (action.type === 'disconnect-source') {
        disconnectSource(action)
        continue
      }

      removeDeployment(action)
    }

    verifyStandby(options.environment)
  }

  console.log(
    JSON.stringify(
      {
        environment: options.environment,
        mode: options.apply ? 'applied' : 'plan',
        actions,
      },
      null,
      2
    )
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
