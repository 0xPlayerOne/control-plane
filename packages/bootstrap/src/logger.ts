import process from 'node:process'

export interface StructuredLogEntry {
  readonly level: 'error' | 'info'
  readonly event: string
  readonly metadata?: Readonly<object>
  readonly details?: unknown
}

export interface StructuredLogger {
  write(entry: StructuredLogEntry): void
}

export const jsonLogger: StructuredLogger = {
  write(entry) {
    const destination = entry.level === 'error' ? process.stderr : process.stdout
    destination.write(`${JSON.stringify(entry)}\n`)
  },
}
