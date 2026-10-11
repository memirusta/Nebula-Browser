const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',')

/** Match the visible keyboard order, including controls in expandable panels. */
export function focusableElements(root: HTMLElement): HTMLElement[] {
  const visible = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.matches(':disabled, input[type="hidden"]')) return false
    if (element.tabIndex < 0 && !element.isContentEditable) return false
    if (element.hasAttribute('tabindex') && element.tabIndex < 0) return false
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    if (element.getClientRects().length === 0) return false
    const visibility = window.getComputedStyle(element).visibility
    if (visibility === 'hidden' || visibility === 'collapse') return false

    // A closed details element keeps only its first summary in the tab order.
    // Its other descendants can still have layout boxes in Chromium.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement && !parent.open) {
        const summary = Array.from(parent.children).find((child) => child.tagName === 'SUMMARY')
        if (!summary?.contains(element)) return false
      }
    }
    return true
  })
  return visible.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name) return true
    const group = visible.filter((other): other is HTMLInputElement =>
      other instanceof HTMLInputElement && other.type === 'radio' &&
      other.name === element.name && other.form === element.form,
    )
    return element === (group.find((radio) => radio.checked) ?? group[0])
  }).sort((a, b) => {
    // Positive tabindex precedes the ordinary DOM order (stable for ties).
    const order = (element: HTMLElement) => element.tabIndex > 0 ? element.tabIndex : Infinity
    return order(a) - order(b)
  })
}

/** Advance every step so excluded controls between the endpoints cannot take focus. */
export function moveModalTabFocus(root: HTMLElement, backwards: boolean): void {
  const elements = focusableElements(root)
  if (elements.length === 0) {
    root.focus()
    return
  }
  const index = elements.indexOf(document.activeElement as HTMLElement)
  const next = backwards
    ? (index <= 0 ? elements.length - 1 : index - 1)
    : (index + 1) % elements.length
  // Let the panel's scroll container reveal the newly focused control.
  ;(elements[next] ?? root).focus()
}
