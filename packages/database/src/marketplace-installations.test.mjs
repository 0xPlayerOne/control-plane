import { describe, expect, test } from 'bun:test'
import { marketplaceInstallations } from './schema/marketplace-installations.ts'

describe('marketplace installation schema', () => {
  test('fits canonical catalog and release identifiers', () => {
    expect('catalog:' + 'a'.repeat(64)).toHaveLength(72)
    expect('release:' + 'b'.repeat(64)).toHaveLength(72)
    expect(marketplaceInstallations.catalogId.length).toBe(72)
    expect(marketplaceInstallations.releaseId.length).toBe(72)
  })
})
