const sensitiveKeyPattern =
  /^(?:api[_-]?key|authorization|cookie|credential|file[_-]?contents?|model[_-]?input|passw(?:or)?d|prompt|secret|token|tool[_-]?input)$/i
const secretInTextPattern = /(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/gi

function redactText(value: string): string {
  return value.replace(secretInTextPattern, '$1=[REDACTED]')
}

export function redactTelemetryValue(value: unknown): unknown {
  return redact(value, new WeakSet<object>())
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value)
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) }
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => redact(item, seen))

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    result[key] = sensitiveKeyPattern.test(key) ? '[REDACTED]' : redact(nested, seen)
  }
  return result
}

export function sanitizeAttributes(
  attributes: Readonly<Record<string, unknown>>
): Readonly<Record<string, boolean | number | string>> {
  const sanitized: Record<string, boolean | number | string> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (sensitiveKeyPattern.test(key)) sanitized[key] = '[REDACTED]'
    else if (typeof value === 'boolean' || typeof value === 'number') sanitized[key] = value
    else if (typeof value === 'string') sanitized[key] = redactText(value)
  }
  return sanitized
}
