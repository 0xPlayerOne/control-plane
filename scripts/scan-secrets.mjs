import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findCredentialLeaks } from '../packages/production-readiness/src/index.ts'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const tracked = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }
)
  .split('\0')
  .filter(Boolean)

const findings = []
let scanned = 0
for (const path of tracked) {
  let buffer
  try {
    buffer = await readFile(resolve(repositoryRoot, path))
  } catch (error) {
    if (error?.code === 'ENOENT') continue
    throw error
  }
  if (buffer.byteLength > 5_242_880 || buffer.includes(0)) continue
  scanned += 1
  findings.push(...findCredentialLeaks(path, buffer.toString('utf8')))
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`${finding.path}: ${finding.rule}`)
  throw new Error(`Credential scan found ${findings.length} prohibited pattern(s).`)
}

console.log(`Credential scan passed across ${scanned} repository files.`)
