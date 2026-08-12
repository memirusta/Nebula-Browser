import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  )
}

/** Keep keyboard focus inside a modal surface and restore it when the modal closes. */
export function useModalFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active = true,
): void {
  useEffect(() => {
    if (!active) return

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusInside = () => {
      const root = containerRef.current
      if (!root) return
      if (document.activeElement instanceof Node && root.contains(document.activeElement)) return
      const first = focusableElements(root)[0]
      ;(first ?? root).focus()
    }

    const focusTimer = window.setTimeout(focusInside, 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const root = containerRef.current
      if (!root) return

      const focusable = focusableElements(root)
      if (focusable.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }

      const activeElement = document.activeElement as HTMLElement | null
      const currentIndex = activeElement ? focusable.indexOf(activeElement) : -1
      const lastIndex = focusable.length - 1

      if (event.shiftKey) {
        if (currentIndex <= 0) {
          event.preventDefault()
          focusable[lastIndex]?.focus()
        }
        return
      }

      if (currentIndex === -1 || currentIndex === lastIndex) {
        event.preventDefault()
        focusable[0]?.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [active, containerRef])
}
