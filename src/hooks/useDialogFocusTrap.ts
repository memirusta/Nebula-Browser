import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { canRestoreModalFocus, registerModalFocusTrap } from '../core/modalFocusStack'
import { focusableElements, moveModalTabFocus } from '../core/focusableElements'

interface DialogFocusTrapOptions {
  active: boolean
  containerRef: RefObject<HTMLElement | null>
  initialFocusRef?: RefObject<HTMLElement | null>
  onEscape?: () => void
  restoreFocus?: boolean
}

/**
 * Keeps keyboard focus inside a modal surface and restores the element that
 * opened it. No dependency on a UI framework, so it also works inside Tauri.
 */
export function useDialogFocusTrap({
  active,
  containerRef,
  initialFocusRef,
  onEscape,
  restoreFocus = true,
}: DialogFocusTrapOptions) {
  const onEscapeRef = useRef(onEscape)
  useLayoutEffect(() => { onEscapeRef.current = onEscape }, [onEscape])

  useEffect(() => {
    if (!active) return

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const trap = registerModalFocusTrap(containerRef)

    const focusFrame = window.requestAnimationFrame(() => {
      if (!trap.isTopmost()) return
      const container = containerRef.current
      if (!container) return
      const target = initialFocusRef?.current ?? focusableElements(container)[0] ?? container
      target.focus({ preventScroll: true })
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (!trap.isTopmost()) return
      const container = containerRef.current
      if (!container) return

      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault()
        event.stopPropagation()
        onEscapeRef.current()
        return
      }

      if (event.key !== 'Tab') return

      event.preventDefault()
      moveModalTabFocus(container, event.shiftKey)
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', onKeyDown, true)
      trap.unregister()
      if (restoreFocus && previouslyFocused) {
        window.requestAnimationFrame(() => {
          if (canRestoreModalFocus(previouslyFocused)) {
            previouslyFocused.focus({ preventScroll: true })
          }
        })
      }
    }
  }, [active, containerRef, initialFocusRef, restoreFocus])
}
