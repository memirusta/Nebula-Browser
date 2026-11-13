/**
 * The colours of Nebula's interface (the theme and the palette) as plain colours, for the two small surfaces that are drawn
 * inside a web page by the page script (the list of saved accounts under a sign-in field and the "save this password"
 * bubble): the page has none of Nebula's style sheets, so the shell reads the colours and sends them with the message.
 */
export interface PopupTheme {
  /** The dark themes (the scrollbar of the list follows it). */
  dark: boolean
  card: string
  text: string
  muted: string
  border: string
  field: string
  surface: string
  accent: string
  strong: string
  ink: string
  on: string
  soft: string
  softBorder: string
}

const VARIABLES: Record<Exclude<keyof PopupTheme, 'dark'>, string> = {
  card: '--nebula-pop',
  text: '--nebula-text',
  muted: '--nebula-text-muted',
  border: '--nebula-glass-border',
  field: '--nebula-field-border',
  surface: '--nebula-surface-2',
  accent: '--nebula-accent',
  strong: '--nebula-accent-strong',
  ink: '--nebula-accent-ink',
  on: '--nebula-on-accent',
  soft: '--nebula-soft',
  softBorder: '--nebula-soft-border',
}

/** The tokens as resolved colours. A custom property only holds text such as "color-mix(...)", so each is read back through
 * the colour of a probe element, which the browser resolves. */
export function readPopupTheme(root: HTMLElement = document.documentElement): PopupTheme {
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  root.appendChild(probe)
  try {
    const resolved = {} as Record<Exclude<keyof PopupTheme, 'dark'>, string>
    for (const [key, variable] of Object.entries(VARIABLES) as Array<[Exclude<keyof PopupTheme, 'dark'>, string]>) {
      probe.style.color = ''
      probe.style.color = `var(${variable})`
      resolved[key] = getComputedStyle(probe).color
    }
    return { dark: root.dataset.theme !== 'light', ...resolved }
  } finally {
    probe.remove()
  }
}
