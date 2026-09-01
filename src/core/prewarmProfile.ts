export function prewarmProfileMatches(
  createdPrivateMode: boolean | null,
  requestedPrivateMode: boolean,
): boolean {
  return createdPrivateMode !== null && createdPrivateMode === requestedPrivateMode
}

export function prewarmCreationIsCurrent(
  capturedGeneration: number,
  currentGeneration: number,
  createdPrivateMode: boolean,
  requestedPrivateMode: boolean,
): boolean {
  return (
    capturedGeneration === currentGeneration &&
    prewarmProfileMatches(createdPrivateMode, requestedPrivateMode)
  )
}

export const PREWARM_MEMORY_PRESSURE_LIMIT_PERCENT = 85

export function shouldKeepPrewarmedWebview(
  memoryPressurePercent: number,
): boolean {
  return (
    Number.isFinite(memoryPressurePercent) &&
    memoryPressurePercent < PREWARM_MEMORY_PRESSURE_LIMIT_PERCENT
  )
}
