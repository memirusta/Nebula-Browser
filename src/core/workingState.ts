export async function withWorkingState<T>(
  setWorking: (working: boolean) => void,
  task: () => Promise<T>,
): Promise<T> {
  setWorking(true)
  try {
    return await task()
  } finally {
    setWorking(false)
  }
}
