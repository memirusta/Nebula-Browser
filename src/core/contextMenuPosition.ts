export interface ContextMenuPositionInput {
  anchorX: number
  anchorY: number
  menuWidth: number
  menuHeight: number
  viewportLeft?: number
  viewportTop?: number
  viewportWidth: number
  viewportHeight: number
  margin?: number
}

export function fitContextMenuPosition({
  anchorX,
  anchorY,
  menuWidth,
  menuHeight,
  viewportLeft = 0,
  viewportTop = 0,
  viewportWidth,
  viewportHeight,
  margin = 8,
}: ContextMenuPositionInput): { left: number; top: number } {
  const viewportRight = viewportLeft + viewportWidth
  const viewportBottom = viewportTop + viewportHeight
  let left = anchorX
  let top = anchorY

  if (left + menuWidth + margin > viewportRight) {
    left = anchorX - menuWidth
  }
  if (top + menuHeight + margin > viewportBottom) {
    top = anchorY - menuHeight
  }

  const maxLeft = Math.max(viewportLeft + margin, viewportRight - menuWidth - margin)
  const maxTop = Math.max(viewportTop + margin, viewportBottom - menuHeight - margin)

  return {
    left: Math.max(viewportLeft + margin, Math.min(left, maxLeft)),
    top: Math.max(viewportTop + margin, Math.min(top, maxTop)),
  }
}
