import { createHash } from 'node:crypto'
import type { TelemetrySamplingPolicy } from './types.js'

export function createDeterministicSamplingPolicy(options: {
  readonly ratio: number
  readonly salt?: string
}): TelemetrySamplingPolicy {
  if (!Number.isFinite(options.ratio) || options.ratio < 0 || options.ratio > 1) {
    throw new RangeError('Sampling ratio must be between zero and one')
  }
  return {
    shouldSample({ name, identifiers }) {
      if (options.ratio === 0) return false
      if (options.ratio === 1) return true
      const stableIdentity =
        identifiers.executionId ?? identifiers.correlationId ?? identifiers.requestId ?? name
      const digest = createHash('sha256')
        .update(options.salt ?? '')
        .update('\0')
        .update(stableIdentity)
        .digest()
      return digest.readUInt32BE(0) / 0x1_0000_0000 < options.ratio
    },
  }
}
