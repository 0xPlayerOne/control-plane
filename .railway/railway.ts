import { defineRailway, github, image, preserve, project, service, volume } from 'railway/iac'

const repository = '0xPlayerOne/control-plane'
const restateImage =
  'docker.restate.dev/restatedev/restate:1.7.7@sha256:dd1695b61c9de877d24bf9afe8a0ac5fb0f66d175c1bc397975d2252bd784eb2'

export default defineRailway((context) => {
  const production = context.isEnvironment('production')
  const applicationEnvironment = production ? 'production' : 'staging'
  const restateData = volume('restate-data')

  const controlApi = service('@control-plane/control-api', {
    source: github(repository, { branch: 'main' }),
    build: {
      builder: 'RAILPACK',
      buildCommand: 'bun run build --filter=@control-plane/control-api...',
      watchPatterns: ['/apps/control-api/**', '/packages/**', '/bun.lock', '/package.json'],
    },
    deploy: {
      startCommand: 'bun run --filter=@control-plane/control-api start',
      healthcheckPath: '/ready',
      healthcheckTimeout: 60,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 5,
    },
    networking: { privateNetworkEndpoint: 'control-planecontrol-api' },
    env: {
      APP_ENV: applicationEnvironment,
      COMMIT_SHA: preserve(),
      SERVICE_VERSION: preserve(),
      DATABASE_URL: preserve(),
      CONTROL_PLANE_SECRET_ENCRYPTION_KEY: preserve(),
      CONTROL_PLANE_SERVICE_AUTH_TOKEN: preserve(),
      R2_ENDPOINT: preserve(),
      R2_BUCKET: 'ctrl-plane',
      R2_REGION: 'auto',
      R2_ACCESS_KEY_ID: preserve(),
      R2_SECRET_ACCESS_KEY: preserve(),
      RESTATE_INGRESS_URL: 'http://control-planerestate.railway.internal:8080',
    },
  })

  const workflowWorker = service('@control-plane/workflow-worker', {
    source: github(repository, { branch: 'main' }),
    build: {
      builder: 'RAILPACK',
      buildCommand: 'bun run build --filter=@control-plane/workflow-worker...',
      watchPatterns: ['/apps/workflow-worker/**', '/packages/**', '/bun.lock', '/package.json'],
    },
    deploy: {
      startCommand: 'bun run --filter=@control-plane/workflow-worker start',
      healthcheckPath: '/ready',
      healthcheckTimeout: 60,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 5,
    },
    networking: { privateNetworkEndpoint: 'control-planeworkflow-worker' },
    env: {
      APP_ENV: applicationEnvironment,
      COMMIT_SHA: preserve(),
      SERVICE_VERSION: preserve(),
      DATABASE_URL: preserve(),
      CONTROL_PLANE_SECRET_ENCRYPTION_KEY: preserve(),
      CONTROL_PLANE_SERVICE_AUTH_TOKEN: preserve(),
      RESTATE_REQUEST_IDENTITY_PUBLIC_KEY: preserve(),
      R2_ENDPOINT: preserve(),
      R2_BUCKET: 'ctrl-plane',
      R2_REGION: 'auto',
      R2_ACCESS_KEY_ID: preserve(),
      R2_SECRET_ACCESS_KEY: preserve(),
    },
  })

  const restate = service('restate', {
    source: image(restateImage),
    deploy: {
      healthcheckPath: '/health',
      healthcheckTimeout: 60,
      restartPolicyType: 'ALWAYS',
    },
    networking: { privateNetworkEndpoint: 'control-planerestate' },
    env: {
      PORT: '9070',
      RESTATE_CLUSTER_NAME: `control-plane-${applicationEnvironment}`,
      RESTATE_NODE_NAME: `control-plane-${applicationEnvironment}-1`,
      RESTATE_AUTO_PROVISION: 'true',
      RESTATE_REQUEST_IDENTITY_PRIVATE_KEY_PEM_FILE: '/restate-data/request-identity-private.pem',
    },
    volumeMounts: { '/restate-data': restateData },
  })

  return project('control-plane', {
    resources: [controlApi, workflowWorker, restate, restateData],
  })
})
