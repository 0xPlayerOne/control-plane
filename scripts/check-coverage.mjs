import { readFile } from 'node:fs/promises'
import process from 'node:process'

export function summarizeLcov(lcov) {
  const totals = {
    functions: { found: 0, hit: 0 },
    lines: { found: 0, hit: 0 },
  }

  for (const line of lcov.split('\n')) {
    const [key, rawValue] = line.split(':', 2)
    const value = Number(rawValue)
    if (!Number.isFinite(value)) continue

    if (key === 'FNF') totals.functions.found += value
    if (key === 'FNH') totals.functions.hit += value
    if (key === 'LF') totals.lines.found += value
    if (key === 'LH') totals.lines.hit += value
  }

  return Object.fromEntries(
    Object.entries(totals).map(([metric, { found, hit }]) => [
      metric,
      found === 0 ? 0 : (hit / found) * 100,
    ])
  )
}

export function parseCoverageMinimum(config) {
  const match = config.match(/^coverage_minimum:\s*(\d+(?:\.\d+)?)\s*$/m)
  if (!match) throw new Error('Code Foundry coverage_minimum is not configured.')
  return Number(match[1])
}

export function assertCoverageGoal(summary, minimum) {
  const failures = Object.entries(summary).filter(([, percentage]) => percentage < minimum)
  if (failures.length > 0) {
    throw new Error(
      failures
        .map(
          ([metric, percentage]) =>
            `${metric} coverage ${percentage.toFixed(2)}% is below the ${minimum.toFixed(2)}% goal`
        )
        .join('; ')
    )
  }
}

if (import.meta.main) {
  const [path = 'coverage/lcov.info', rawMinimum] = process.argv.slice(2)
  const minimum = rawMinimum
    ? Number(rawMinimum)
    : parseCoverageMinimum(await readFile('.github/code-foundry.yml', 'utf8'))
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
    throw new Error(`Invalid coverage goal: ${rawMinimum}`)
  }

  const summary = summarizeLcov(await readFile(path, 'utf8'))
  assertCoverageGoal(summary, minimum)
  process.stdout.write(
    `Coverage goal met: ${summary.lines.toFixed(2)}% lines, ${summary.functions.toFixed(2)}% functions (minimum ${minimum.toFixed(2)}%).\n`
  )
}
