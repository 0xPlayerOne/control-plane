import { describe, expect, test } from 'bun:test'
import { DeploymentProfiles } from './index.ts'

describe('deployment profile contracts', () => {
  test('publishes exactly the accepted product profiles', () => {
    expect(Object.values(DeploymentProfiles)).toEqual([
      'cloud',
      'local',
      'hosted-simple',
      'hosted-server',
    ])
  })

  test('keeps the profile catalog immutable', () => {
    expect(Object.isFrozen(DeploymentProfiles)).toBe(true)
  })
})
