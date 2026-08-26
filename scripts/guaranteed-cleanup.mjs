export async function withGuaranteedCleanup(operation, cleanup) {
  try {
    return await operation()
  } finally {
    await cleanup()
  }
}
