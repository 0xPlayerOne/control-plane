import { parseArgs } from 'node:util'
import {
  createFilesystemCheckpoint,
  restoreFilesystemCheckpoint,
  verifyFilesystemCheckpoint,
} from '../packages/deployment/src/checkpoint.ts'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  strict: true,
  options: {
    apply: { type: 'boolean', default: false },
    checkpoint: { type: 'string' },
    destination: { type: 'string' },
    profile: { type: 'string' },
    source: { type: 'string' },
  },
})

const command = positionals[0]
let result
if (command === 'create') {
  result = await createFilesystemCheckpoint({
    sourceDirectory: required(values.source, '--source'),
    destinationDirectory: required(values.destination, '--destination'),
    profile: profile(values.profile),
  })
} else if (command === 'verify') {
  result = await verifyFilesystemCheckpoint(required(values.checkpoint, '--checkpoint'))
} else if (command === 'restore') {
  const checkpointDirectory = required(values.checkpoint, '--checkpoint')
  const manifest = await verifyFilesystemCheckpoint(checkpointDirectory)
  if (!values.apply) {
    result = { outcome: 'verified-dry-run', ...summary(manifest) }
  } else {
    result = await restoreFilesystemCheckpoint({
      checkpointDirectory,
      destinationDirectory: required(values.destination, '--destination'),
    })
  }
} else {
  throw new Error('Usage: control-plane-checkpoint <create|verify|restore> [options]')
}

console.log(JSON.stringify(summary(result)))

function required(value, name) {
  if (value === undefined || value.length === 0) throw new Error(`Missing ${name}`)
  return value
}

function profile(value) {
  if (value !== 'local' && value !== 'hosted-simple') {
    throw new Error('--profile must be local or hosted-simple')
  }
  return value
}

function summary(manifest) {
  if (manifest.outcome === 'verified-dry-run') return manifest
  return {
    schemaVersion: manifest.schemaVersion,
    profile: manifest.profile,
    contentDigest: manifest.contentDigest,
    entryCount: manifest.entries.length,
  }
}
