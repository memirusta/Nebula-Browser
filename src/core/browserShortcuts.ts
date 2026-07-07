/** Chrome-aligned browser shortcut identifiers. */
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
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'devtools'
  | 'close-overlay'

/** Tauri global-shortcut registration strings (Windows / Chrome defaults). */
export const BROWSER_GLOBAL_SHORTCUTS: { id: BrowserShortcutId; accelerator: string }[] = [
  { id: 'new-tab', accelerator: 'Control+T' },
  { id: 'close-tab', accelerator: 'Control+W' },
  { id: 'reopen-tab', accelerator: 'Control+Shift+T' },
  { id: 'next-tab', accelerator: 'Control+Tab' },
  { id: 'prev-tab', accelerator: 'Control+Shift+Tab' },
  { id: 'switch-tab-1', accelerator: 'Control+1' },
  { id: 'switch-tab-2', accelerator: 'Control+2' },
  { id: 'switch-tab-3', accelerator: 'Control+3' },
  { id: 'switch-tab-4', accelerator: 'Control+4' },
  { id: 'switch-tab-5', accelerator: 'Control+5' },
  { id: 'switch-tab-6', accelerator: 'Control+6' },
  { id: 'switch-tab-7', accelerator: 'Control+7' },
  { id: 'switch-tab-8', accelerator: 'Control+8' },
  { id: 'switch-tab-last', accelerator: 'Control+9' },
  { id: 'reload', accelerator: 'Control+R' },
  { id: 'reload', accelerator: 'F5' },
  { id: 'focus-url-bar', accelerator: 'Control+L' },
  { id: 'focus-url-bar', accelerator: 'Alt+D' },
  { id: 'go-back', accelerator: 'Alt+Left' },
  { id: 'go-forward', accelerator: 'Alt+Right' },
  { id: 'go-home', accelerator: 'Control+H' },
  { id: 'zoom-in', accelerator: 'Control+Equal' },
  { id: 'zoom-in', accelerator: 'Control+Plus' },
  { id: 'zoom-out', accelerator: 'Control+Minus' },
  { id: 'zoom-reset', accelerator: 'Control+0' },
  { id: 'devtools', accelerator: 'Control+Shift+I' },
  { id: 'devtools', accelerator: 'F12' },
]

const ACCELERATOR_TO_ID = new Map(
  BROWSER_GLOBAL_SHORTCUTS.map((entry) => [entry.accelerator, entry.id] as const),
)

export function shortcutIdFromAccelerator(accelerator: string): BrowserShortcutId | null {
  return ACCELERATOR_TO_ID.get(accelerator) ?? null
}

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

  if (mod && !event.altKey && key === 't' && !event.shiftKey) return 'new-tab'
  if (mod && !event.altKey && key === 'w' && !event.shiftKey) return 'close-tab'
  if (mod && !event.altKey && key === 't' && event.shiftKey) return 'reopen-tab'
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
  if (mod && !event.altKey && (key === 'h' || key === 'H') && !event.shiftKey) return 'go-home'
  if (mod && !event.altKey && (key === '=' || key === '+')) return 'zoom-in'
  if (mod && !event.altKey && key === '-') return 'zoom-out'
  if (mod && !event.altKey && key === '0') return 'zoom-reset'
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
