import { spawnSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import process from 'node:process'

const repositoryRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const environments = ['development', 'staging', 'production']
const formatOnly = process.argv.includes('--format-only')

const executableOnPath = (name) => {
  const result = spawnSync('sh', ['-c', 'command -v "$1"', 'sh', name], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

const terraform = executableOnPath('terraform')

const run = (workingDirectory, args) => {
  let command
  let commandArgs

  if (terraform) {
    command = terraform
    commandArgs = args
  } else {
    const docker = executableOnPath('docker')
    if (!docker) throw new Error('Terraform validation requires terraform or Docker.')
    accessSync(repositoryRoot, constants.R_OK)
    command = docker
    commandArgs = [
      'run',
      '--rm',
      '--volume',
      `${repositoryRoot}:/workspace`,
      '--workdir',
      `/workspace/${workingDirectory}`,
      'hashicorp/terraform:1.13.5',
      ...args,
    ]
  }

  const result = spawnSync(command, commandArgs, {
    cwd: `${repositoryRoot}/${workingDirectory}`,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('infrastructure/terraform', ['fmt', '-check', '-recursive', '-diff'])

if (!formatOnly) {
  for (const environment of environments) {
    const root = `infrastructure/terraform/environments/${environment}`
    run(root, ['init', '-backend=false', '-input=false', '-no-color'])
    run(root, ['validate', '-no-color'])
  }
}
