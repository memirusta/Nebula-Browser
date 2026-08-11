/** Nebula browser shortcut identifiers. */
export type BrowserShortcutId =
  | 'new-tab'
  | 'close-tab'
  | 'reopen-tab'
  | 'next-tab'
  | 'prev-tab'
  | 'switch-tab-1'
  | 'switch-tab-2'
  | 'switch-tab-3'
  | 'switch-tab-4'
  | 'switch-tab-5'
  | 'switch-tab-6'
  | 'switch-tab-7'
  | 'switch-tab-8'
  | 'switch-tab-last'
  | 'reload'
  | 'focus-url-bar'
  | 'go-back'
  | 'go-forward'
  | 'go-home'
  | 'open-history'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'print'
  | 'toggle-fullscreen'
  | 'devtools'
  | 'close-overlay'

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return !!target.closest('[contenteditable="true"]')
}

/** Match Chrome shortcuts when the main shell webview has focus (dev / fallback). */
export function matchBrowserShortcut(event: KeyboardEvent): BrowserShortcutId | null {
  if (event.defaultPrevented || event.repeat) return null
  if (event.altKey && event.key === 'F4') return null

  const mod = event.ctrlKey || event.metaKey
  const key = event.key

  if (mod && !event.altKey && key === 'w' && !event.shiftKey) return 'close-tab'
  if (mod && !event.altKey && (key === 't' || key === 'T') && event.shiftKey) return 'reopen-tab'
  if (mod && !event.altKey && key === 'Tab' && !event.shiftKey) return 'next-tab'
  if (mod && !event.altKey && key === 'Tab' && event.shiftKey) return 'prev-tab'
  if (mod && !event.altKey && /^[1-8]$/.test(key)) return `switch-tab-${key}` as BrowserShortcutId
  if (mod && !event.altKey && key === '9') return 'switch-tab-last'
  if (mod && !event.altKey && (key === 'r' || key === 'R') && !event.shiftKey) return 'reload'
  if (!mod && !event.altKey && key === 'F5') return 'reload'
  if (mod && !event.altKey && (key === 'l' || key === 'L') && !event.shiftKey) return 'focus-url-bar'
  if (!mod && event.altKey && (key === 'd' || key === 'D') && !event.shiftKey) return 'focus-url-bar'
  if (!mod && event.altKey && key === 'ArrowLeft') return 'go-back'
  if (!mod && event.altKey && key === 'ArrowRight') return 'go-forward'
  if (mod && !event.altKey && (key === 't' || key === 'T') && !event.shiftKey) return 'go-home'
  if (mod && !event.altKey && (key === 'h' || key === 'H') && !event.shiftKey) return 'open-history'
  if (mod && !event.altKey && (key === '=' || key === '+')) return 'zoom-in'
  if (mod && !event.altKey && key === '-') return 'zoom-out'
  if (mod && !event.altKey && key === '0') return 'zoom-reset'
  if (mod && !event.altKey && !event.shiftKey && (key === 'p' || key === 'P')) return 'print'
  if (!mod && !event.altKey && key === 'F11') return 'toggle-fullscreen'
  if (mod && !event.altKey && event.shiftKey && (key === 'i' || key === 'I')) return 'devtools'
  if (!mod && !event.altKey && key === 'F12') return 'devtools'
  if (!mod && !event.altKey && key === 'Escape') return 'close-overlay'

  return null
}

export function shouldIgnoreShellShortcut(event: KeyboardEvent): boolean {
  const action = matchBrowserShortcut(event)
  if (!action) return false
  if (action === 'close-overlay') return false
  if (action === 'focus-url-bar' && isEditableElement(event.target)) {
    return true
  }
  return false
}
