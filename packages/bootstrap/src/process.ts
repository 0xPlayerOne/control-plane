import process from 'node:process'

export type ProcessEvent = 'SIGINT' | 'SIGTERM' | 'uncaughtException' | 'unhandledRejection'
export type ProcessListener = (value?: unknown) => void | Promise<void>

export interface ProcessAdapter {
  on(event: ProcessEvent, listener: ProcessListener): void
  off(event: ProcessEvent, listener: ProcessListener): void
  setExitCode(code: number): void
}

export const nodeProcessAdapter: ProcessAdapter = {
  on(event, listener) {
    process.on(event, listener)
  },
  off(event, listener) {
    process.off(event, listener)
  },
  setExitCode(code) {
    process.exitCode = code
  },
}
