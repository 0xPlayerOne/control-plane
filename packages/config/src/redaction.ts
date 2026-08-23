const redactedValue = '[REDACTED]'
const circularValue = '[Circular]'
const sensitiveKey = /authorization|cookie|credential|password|private.?key|secret|token|api.?key/i

export function redactDiagnostics(value: unknown, additionalKeys: readonly string[] = []): unknown {
  const explicitKeys = new Set(additionalKeys.map(normalizeKey))
  return redactValue(value, explicitKeys, new WeakSet())
}

function redactValue(
  value: unknown,
  explicitKeys: ReadonlySet<string>,
  seen: WeakSet<object>
): unknown {
  if (value instanceof Error) return { name: value.name, message: 'Service operation failed' }
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return circularValue
  seen.add(value)

  if (Array.isArray(value)) return value.map((item) => redactValue(item, explicitKeys, seen))

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key, explicitKeys) ? redactedValue : redactValue(item, explicitKeys, seen),
    ])
  )
}

function isSensitiveKey(key: string, explicitKeys: ReadonlySet<string>): boolean {
  return sensitiveKey.test(key) || explicitKeys.has(normalizeKey(key))
}

function normalizeKey(key: string): string {
  return key.replaceAll(/[^A-Za-z0-9]/g, '').toLowerCase()
}
