export interface TestClock {
  now(): Date
}

export interface RecordingAdapter<Input, Output> {
  readonly calls: readonly Input[]
  invoke(input: Input): Promise<Output>
}

export interface TestApplication {
  close(): void | Promise<void>
}

export function createDeterministicIdGenerator(prefix = 'test'): () => string {
  let sequence = 0
  return () => `${prefix}-${String(++sequence).padStart(4, '0')}`
}

export function createFixedClock(value: string | Date): TestClock {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) throw new TypeError('Fixed clock requires a valid date')
  return { now: () => new Date(timestamp) }
}

export function createRecordingAdapter<Input, Output>(
  handler: (input: Input) => Output | Promise<Output>
): RecordingAdapter<Input, Output> {
  const calls: Input[] = []
  return {
    get calls() {
      return calls.map((input) => structuredClone(input))
    },
    async invoke(input) {
      calls.push(structuredClone(input))
      return handler(input)
    },
  }
}

export async function withTestApplication<Application extends TestApplication, Result>(
  createApplication: () => Application | Promise<Application>,
  operation: (application: Application) => Result | Promise<Result>
): Promise<Result> {
  const application = await createApplication()
  try {
    return await operation(application)
  } finally {
    await application.close()
  }
}
