import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.getAttribute('aria-hidden') === 'true') return false
    const style = window.getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })
}

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
  onEscapeRef.current = onEscape

  useEffect(() => {
    if (!active) return

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    const focusFrame = window.requestAnimationFrame(() => {
      const container = containerRef.current
      if (!container) return
      const target = initialFocusRef?.current ?? getFocusable(container)[0] ?? container
      target.focus({ preventScroll: true })
    })

    const onKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current
      if (!container) return

      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault()
        event.stopPropagation()
        onEscapeRef.current()
        return
      }

      if (event.key !== 'Tab') return

      const focusable = getFocusable(container)
      if (focusable.length === 0) {
        event.preventDefault()
        container.focus({ preventScroll: true })
        return
      }

      const activeElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      const index = activeElement ? focusable.indexOf(activeElement) : -1

      if (event.shiftKey) {
        if (index <= 0) {
          event.preventDefault()
          focusable[focusable.length - 1].focus({ preventScroll: true })
        }
        return
      }

      if (index === -1 || index === focusable.length - 1) {
        event.preventDefault()
        focusable[0].focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', onKeyDown, true)
      if (restoreFocus && previouslyFocused?.isConnected) {
        window.requestAnimationFrame(() => previouslyFocused.focus({ preventScroll: true }))
      }
    }
  }, [active, containerRef, initialFocusRef, restoreFocus])
}
