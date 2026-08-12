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
