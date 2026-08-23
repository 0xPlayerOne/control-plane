import process from 'node:process'
import { redactTelemetryValue } from './redaction.js'
import type { StructuredLogEntry, StructuredLogger } from './types.js'

export interface StructuredLoggerOptions {
  readonly now?: () => Date
  readonly writeLine: (line: string, level: StructuredLogEntry['level']) => void
}

export function createStructuredLogger(options: StructuredLoggerOptions): StructuredLogger {
  return {
    write(entry) {
      const payload = redactTelemetryValue({
        timestamp: (options.now ?? (() => new Date()))().toISOString(),
        ...entry,
      })
      options.writeLine(JSON.stringify(payload), entry.level)
    },
  }
}

export const jsonLogger = createStructuredLogger({
  writeLine(line, level) {
    const destination = level === 'error' ? process.stderr : process.stdout
    destination.write(`${line}\n`)
  },
})
