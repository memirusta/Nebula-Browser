interface ModalFocusEntry {
  containerRef: { current: HTMLElement | null }
}

const modalFocusStack: ModalFocusEntry[] = []

/** Both modal hooks share one stack so only the uppermost surface owns focus. */
export function registerModalFocusTrap(containerRef: ModalFocusEntry['containerRef']) {
  const entry: ModalFocusEntry = { containerRef }
  modalFocusStack.push(entry)

  return {
    isTopmost: () => modalFocusStack[modalFocusStack.length - 1] === entry,
    unregister: () => {
      const index = modalFocusStack.indexOf(entry)
      if (index !== -1) modalFocusStack.splice(index, 1)
    },
  }
}

export function canRestoreModalFocus(element: HTMLElement): boolean {
  if (!element.isConnected) return false
  const top = modalFocusStack[modalFocusStack.length - 1]
  return !top || top.containerRef.current?.contains(element) === true
}
