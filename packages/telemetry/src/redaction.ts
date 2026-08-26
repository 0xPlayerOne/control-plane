import type { SpanOutcome } from './types.js'

const sensitiveKeyPattern =
  /^(?:access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|credential|file[_-]?contents?|id[_-]?token|model[_-]?input|passw(?:or)?d|prompt|refresh[_-]?token|secret|(?:aws[_-]?)?secret[_-]?access[_-]?key|token|tool[_-]?input)$/i
const secretsInText = [
  {
    pattern:
      /(api[_-]?key|authorization|credential|password|secret(?:[_-]?access[_-]?key)?|token)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi,
    replacement: '$1=[REDACTED]',
  },
  { pattern: /\bBearer\s+[^\s,;]+/gi, replacement: 'Bearer [REDACTED]' },
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{82})\b/g,
    replacement: '[REDACTED]',
  },
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replacement: '[REDACTED]' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: '[REDACTED]' },
  { pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g, replacement: '[REDACTED]' },
  { pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g, replacement: '[REDACTED]' },
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/:]+:[^@\s]+@/gi,
    replacement: '$1[REDACTED]@',
  },
  {
    pattern:
      /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
    replacement: '[REDACTED]',
  },
] as const

function redactText(value: string): string {
  return secretsInText.reduce(
    (redacted, { pattern, replacement }) => redacted.replace(pattern, replacement),
    value
  )
}

export function redactTelemetryValue(value: unknown): unknown {
  return redact(value, new WeakSet<object>())
}

export function sanitizeSpanOutcome(outcome: SpanOutcome): SpanOutcome {
  if (outcome.status !== 'error' || outcome.error === undefined) {
    return { status: outcome.status }
  }
  return { status: 'error', error: redactTelemetryValue(outcome.error) }
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
