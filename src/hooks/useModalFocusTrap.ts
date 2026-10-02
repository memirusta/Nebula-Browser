import { useEffect, type RefObject } from 'react'
import { canRestoreModalFocus, registerModalFocusTrap } from '../core/modalFocusStack'
import { focusableElements, moveModalTabFocus } from '../core/focusableElements'

/** Keep keyboard focus inside a modal surface and restore it when the modal closes. */
export function useModalFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active = true,
): void {
  useEffect(() => {
    if (!active) return

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const trap = registerModalFocusTrap(containerRef)

    const focusInside = () => {
      if (!trap.isTopmost()) return
      const root = containerRef.current
      if (!root) return
      if (document.activeElement instanceof Node && root.contains(document.activeElement)) return
      const first = focusableElements(root)[0]
      ;(first ?? root).focus()
    }

    const focusTimer = window.setTimeout(focusInside, 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (!trap.isTopmost()) return
      if (event.key !== 'Tab') return
      const root = containerRef.current
      if (!root) return

      event.preventDefault()
      moveModalTabFocus(root, event.shiftKey)
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown, true)
      trap.unregister()
      if (previousFocus && canRestoreModalFocus(previousFocus)) previousFocus.focus()
    }
  }, [active, containerRef])
}
