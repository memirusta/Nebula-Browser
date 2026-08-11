import { persistLocalStorage } from './storageSync'

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

export type ConfigurableBrowserShortcutId = Exclude<
  BrowserShortcutId,
  'new-tab' | 'close-overlay'
>

export type BrowserShortcutBindings = Record<ConfigurableBrowserShortcutId, string[]>

export const BROWSER_SHORTCUT_BINDINGS_KEY = 'nebula-browser-shortcut-bindings-v1'
const BROWSER_SHORTCUT_BINDINGS_VERSION = 1 as const

export const CONFIGURABLE_BROWSER_SHORTCUT_IDS: ConfigurableBrowserShortcutId[] = [
  'close-tab',
  'reopen-tab',
  'next-tab',
  'prev-tab',
  'switch-tab-1',
  'switch-tab-2',
  'switch-tab-3',
  'switch-tab-4',
  'switch-tab-5',
  'switch-tab-6',
  'switch-tab-7',
  'switch-tab-8',
  'switch-tab-last',
  'reload',
  'focus-url-bar',
  'go-back',
  'go-forward',
  'go-home',
  'open-history',
  'zoom-in',
  'zoom-out',
  'zoom-reset',
  'print',
  'toggle-fullscreen',
  'devtools',
]

export const DEFAULT_BROWSER_SHORTCUT_BINDINGS: BrowserShortcutBindings = {
  'close-tab': ['Ctrl+W'],
  'reopen-tab': ['Ctrl+Shift+T'],
  'next-tab': ['Ctrl+Tab'],
  'prev-tab': ['Ctrl+Shift+Tab'],
  'switch-tab-1': ['Ctrl+1'],
  'switch-tab-2': ['Ctrl+2'],
  'switch-tab-3': ['Ctrl+3'],
  'switch-tab-4': ['Ctrl+4'],
  'switch-tab-5': ['Ctrl+5'],
  'switch-tab-6': ['Ctrl+6'],
  'switch-tab-7': ['Ctrl+7'],
  'switch-tab-8': ['Ctrl+8'],
  'switch-tab-last': ['Ctrl+9'],
  reload: ['Ctrl+R', 'F5'],
  'focus-url-bar': ['Ctrl+L', 'Alt+D'],
  'go-back': ['Alt+ArrowLeft'],
  'go-forward': ['Alt+ArrowRight'],
  'go-home': ['Ctrl+T'],
  'open-history': ['Ctrl+H'],
  'zoom-in': ['Ctrl++', 'Ctrl+='],
  'zoom-out': ['Ctrl+-'],
  'zoom-reset': ['Ctrl+0'],
  print: ['Ctrl+P'],
  'toggle-fullscreen': ['F11'],
  devtools: ['Ctrl+Shift+I', 'F12'],
}

const RESERVED_BINDINGS = new Set([
  'Alt+F4',
  'Alt+Tab',
  'Shift+Tab',
  'Ctrl+Alt+Delete',
  'Ctrl+Shift+Escape',
])

const RESERVED_BARE_KEYS = new Set([
  'Escape',
  'Tab',
  'Enter',
  'Space',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

interface StoredBrowserShortcutBindings {
  version: typeof BROWSER_SHORTCUT_BINDINGS_VERSION
  bindings: Partial<Record<ConfigurableBrowserShortcutId, string[]>>
}

export type BrowserShortcutBindingValidation =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'reserved' | 'needs-modifier' }

function cloneBindings(bindings: BrowserShortcutBindings): BrowserShortcutBindings {
  return Object.fromEntries(
    CONFIGURABLE_BROWSER_SHORTCUT_IDS.map((id) => [id, [...bindings[id]]]),
  ) as BrowserShortcutBindings
}

function keyNameFromEvent(event: KeyboardEvent): string | null {
  const key = event.key
  const code = event.code

  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
    return null
  }

  // Use the base key for letters/digits so Ctrl+Shift+1 is represented the
  // same way as WebView2's virtual-key accelerator event (Ctrl+Shift+1), not
  // as the layout-produced symbol (for example Ctrl+Shift+!).
  const keyCode = /^Key([A-Z])$/.exec(code)
  if (keyCode) return keyCode[1]

  const digitCode = /^Digit([0-9])$/.exec(code)
  if (digitCode) return digitCode[1]

  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code
  if (code === 'NumpadAdd') return '+'

  if (key === ' ') return 'Space'
  if (key === 'Esc') return 'Escape'
  if (key === 'Left') return 'ArrowLeft'
  if (key === 'Right') return 'ArrowRight'
  if (key === 'Up') return 'ArrowUp'
  if (key === 'Down') return 'ArrowDown'

  if (/^[a-z]$/i.test(key)) return key.toUpperCase()
  if (/^[0-9]$/.test(key)) return key
  if (/^F(?:[1-9]|1[0-2])$/.test(key)) return key

  if (
    key === 'Tab' ||
    key === 'Enter' ||
    key === 'Escape' ||
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'Home' ||
    key === 'End' ||
    key === 'PageUp' ||
    key === 'PageDown' ||
    key === 'Backspace' ||
    key === 'Delete' ||
    key === 'Insert' ||
    key === '+' ||
    key === '-' ||
    key === '='
  ) {
    return key
  }

  return null
}

/** Convert a DOM keydown into the same canonical string used by native WebView2. */
export function browserShortcutBindingFromEvent(event: KeyboardEvent): string | null {
  if (event.metaKey) return null

  const key = keyNameFromEvent(event)
  if (!key) return null

  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')

  // Shift is implicit when it only produces the '+' glyph on the OEM plus key.
  if (event.shiftKey && key !== '+') parts.push('Shift')

  parts.push(key)
  return parts.join('+')
}

function bindingKey(binding: string): { key: string; hasModifier: boolean } | null {
  let rest = binding
  let hasModifier = false

  for (const modifier of ['Ctrl', 'Alt', 'Shift']) {
    const prefix = `${modifier}+`
    if (rest.startsWith(prefix)) {
      hasModifier = true
      rest = rest.slice(prefix.length)
    }
  }

  if (!rest) return null
  return { key: rest, hasModifier }
}

function supportedCanonicalKey(key: string): boolean {
  return (
    /^[A-Z]$/.test(key) ||
    /^[0-9]$/.test(key) ||
    /^F(?:[1-9]|1[0-2])$/.test(key) ||
    key === 'Tab' ||
    key === 'Enter' ||
    key === 'Escape' ||
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'Home' ||
    key === 'End' ||
    key === 'PageUp' ||
    key === 'PageDown' ||
    key === 'Backspace' ||
    key === 'Delete' ||
    key === 'Insert' ||
    key === '+' ||
    key === '-' ||
    key === '='
  )
}

export function validateBrowserShortcutBinding(
  binding: string,
): BrowserShortcutBindingValidation {
  if (RESERVED_BINDINGS.has(binding)) {
    return { ok: false, reason: 'reserved' }
  }

  const parsed = bindingKey(binding)
  if (!parsed || !supportedCanonicalKey(parsed.key)) {
    return { ok: false, reason: 'unsupported' }
  }

  if (!parsed.hasModifier) {
    if (/^F(?:[1-9]|1[0-2])$/.test(parsed.key)) {
      return { ok: true }
    }

    if (RESERVED_BARE_KEYS.has(parsed.key) || parsed.key.length === 1) {
      return { ok: false, reason: 'needs-modifier' }
    }

    return { ok: false, reason: 'needs-modifier' }
  }

  if (parsed.key === 'Escape') {
    return { ok: false, reason: 'reserved' }
  }

  return { ok: true }
}

export function findBrowserShortcutConflict(
  bindings: BrowserShortcutBindings,
  binding: string,
  exceptAction?: ConfigurableBrowserShortcutId,
): ConfigurableBrowserShortcutId | null {
  for (const action of CONFIGURABLE_BROWSER_SHORTCUT_IDS) {
    if (action === exceptAction) continue
    if (bindings[action].includes(binding)) return action
  }
  return null
}

function sanitizeBindings(value: unknown): BrowserShortcutBindings {
  const requested =
    value && typeof value === 'object'
      ? (value as Partial<Record<ConfigurableBrowserShortcutId, unknown>>)
      : {}

  const result = {} as BrowserShortcutBindings
  const used = new Set<string>()

  for (const action of CONFIGURABLE_BROWSER_SHORTCUT_IDS) {
    const raw = requested[action]
    const candidates = Array.isArray(raw)
      ? raw.filter((entry): entry is string => typeof entry === 'string')
      : DEFAULT_BROWSER_SHORTCUT_BINDINGS[action]

    const accepted: string[] = []
    for (const candidate of candidates) {
      if (!validateBrowserShortcutBinding(candidate).ok || used.has(candidate)) continue
      used.add(candidate)
      accepted.push(candidate)
    }

    if (accepted.length === 0) {
      for (const fallback of DEFAULT_BROWSER_SHORTCUT_BINDINGS[action]) {
        if (!used.has(fallback)) {
          used.add(fallback)
          accepted.push(fallback)
        }
      }
    }

    result[action] = accepted
  }

  return result
}

export function loadBrowserShortcutBindings(): BrowserShortcutBindings {
  try {
    const raw = localStorage.getItem(BROWSER_SHORTCUT_BINDINGS_KEY)
    if (!raw) return cloneBindings(DEFAULT_BROWSER_SHORTCUT_BINDINGS)

    const parsed = JSON.parse(raw) as Partial<StoredBrowserShortcutBindings>
    if (
      parsed.version !== BROWSER_SHORTCUT_BINDINGS_VERSION ||
      !parsed.bindings ||
      typeof parsed.bindings !== 'object'
    ) {
      return cloneBindings(DEFAULT_BROWSER_SHORTCUT_BINDINGS)
    }

    return sanitizeBindings(parsed.bindings)
  } catch {
    return cloneBindings(DEFAULT_BROWSER_SHORTCUT_BINDINGS)
  }
}

export function persistBrowserShortcutBindings(bindings: BrowserShortcutBindings): void {
  const payload: StoredBrowserShortcutBindings = {
    version: BROWSER_SHORTCUT_BINDINGS_VERSION,
    bindings: sanitizeBindings(bindings),
  }
  persistLocalStorage(BROWSER_SHORTCUT_BINDINGS_KEY, JSON.stringify(payload))
}

export function resetBrowserShortcutBindings(): BrowserShortcutBindings {
  const defaults = cloneBindings(DEFAULT_BROWSER_SHORTCUT_BINDINGS)
  persistBrowserShortcutBindings(defaults)
  return defaults
}

export function formatBrowserShortcutBinding(binding: string): string {
  return binding
    .replaceAll('ArrowLeft', '←')
    .replaceAll('ArrowRight', '→')
    .replaceAll('ArrowUp', '↑')
    .replaceAll('ArrowDown', '↓')
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return !!target.closest('[contenteditable="true"]')
}

/** Match configured browser shortcuts when a Nebula shell WebView has focus. */
export function matchBrowserShortcut(
  event: KeyboardEvent,
  bindings: BrowserShortcutBindings = DEFAULT_BROWSER_SHORTCUT_BINDINGS,
): BrowserShortcutId | null {
  if (event.defaultPrevented || event.repeat) return null
  if (event.altKey && event.key === 'F4') return null

  const binding = browserShortcutBindingFromEvent(event)
  if (!binding) return null

  for (const action of CONFIGURABLE_BROWSER_SHORTCUT_IDS) {
    if (bindings[action].includes(binding)) return action
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Escape') {
    return 'close-overlay'
  }

  return null
}

export function shouldIgnoreShellShortcut(
  event: KeyboardEvent,
  bindings: BrowserShortcutBindings = DEFAULT_BROWSER_SHORTCUT_BINDINGS,
): boolean {
  const action = matchBrowserShortcut(event, bindings)
  if (!action) return false
  if (action === 'close-overlay') return false
  if (action === 'focus-url-bar' && isEditableElement(event.target)) {
    return true
  }
  return false
}
