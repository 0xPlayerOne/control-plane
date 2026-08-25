import { expect, test } from 'bun:test'
import { fromEvaluationRunRow, toEvaluationRunRow } from './evaluation-repository.js'

test('evaluation row conversion preserves exact release evidence', () => {
  const run = {
    evalRunId: 'eval-run-release',
    suite: {
      evalSuiteId: 'eval-suite-release',
      version: '1.0.0',
      digest: `sha256:${'1'.repeat(64)}`,
      dataset: { id: 'dataset', version: 'v1', digest: `sha256:${'2'.repeat(64)}` },
      mode: 'offline',
      cases: [
        {
          evalCaseId: 'case-1',
          inputDigest: `sha256:${'3'.repeat(64)}`,
          scorers: [
            {
              metric: 'functional_correctness',
              direction: 'min',
              threshold: 0.9,
              required: true,
            },
          ],
        },
      ],
    },
    configuration: {
      executionPlanDigest: `sha256:${'4'.repeat(64)}`,
      profile: { id: 'profile', version: 'v1', digest: `sha256:${'5'.repeat(64)}` },
      skills: [],
      graph: { id: 'graph', version: 'v1', digest: `sha256:${'6'.repeat(64)}` },
      runtime: { id: 'runtime', version: 'v1', digest: `sha256:${'7'.repeat(64)}` },
      model: { id: 'model', version: 'v1', digest: `sha256:${'8'.repeat(64)}` },
      tools: [],
      policy: { id: 'policy', version: 'v1', digest: `sha256:${'9'.repeat(64)}` },
    },
    results: [
      {
        evalCaseId: 'case-1',
        dataset: { id: 'dataset', version: 'v1', digest: `sha256:${'2'.repeat(64)}` },
        configuration: undefined,
        metrics: { functional_correctness: 1 },
        failedRequiredMetrics: [],
        status: 'passed',
      },
    ],
    aggregateMetrics: { functional_correctness: 1 },
    status: 'passed',
    startedAt: '2026-08-25T12:00:00.000Z',
    completedAt: '2026-08-25T12:00:01.000Z',
  }
  run.results[0].configuration = run.configuration

  expect(fromEvaluationRunRow(toEvaluationRunRow(run))).toEqual(run)
})
