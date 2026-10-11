// What the browser window's webviews should look like while a site is shown, and the logic that
// turns "Windows disagrees with that for a while" into one repair. The native side only reads
// rectangles (src-tauri/src/layout_audit.rs); everything that decides lives here so it can be tested.

export interface HostRect {
  label: string
  /** Client coordinates of the browser window. */
  x: number
  y: number
  width: number
  height: number
  visible: boolean
  /** The scale the webview draws its page at (0 when it could not be read). */
  rasterScale?: number
}

export interface LayoutAudit {
  clientWidth: number
  clientHeight: number
  minimized: boolean
  /** The window's DPI as Windows has it, 96 = 100% (0 when it could not be read). */
  windowDpi?: number
  hosts: HostRect[]
}

export interface LayoutExpectation {
  /** The shell's own webview of this window (Home, shown behind the site). */
  mainLabel: string
  /** The Semi-Lunar overlay. */
  chromeLabel: string
  /** The tab that is shown. */
  activeTabLabel: string
}

export interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutFault {
  label: string
  reason: 'missing' | 'hidden' | 'offset-or-size' | 'scale'
  expected: string
  actual: Rectangle | null
  /** For a scale fault: the scale the webview has. */
  seen?: number
  /** The rectangle that puts it right: the position and width it must have, the height it already has when that is valid. */
  fix: Rectangle
}

const MIN_USABLE_WIDTH = 256
const MIN_USABLE_HEIGHT = 160
/** Only the shape of a repair when the overlay is missing; the real strip height is the shell's (SEMI_LUNAR_HIT_ZONE_HEIGHT x scale). */
const COLLAPSED_STRIP_PX = 10

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance

/**
 * Differences between the real layout and the one a shown site needs: the tab and the shell fill the
 * client area exactly; the overlay is as wide as the client area, at its top edge, and anywhere from
 * its collapsed strip to the full height (it grows over the page while previewed). A minimized window
 * or a transient tiny client size is not judged.
 */
export function findLayoutFaults(
  audit: LayoutAudit,
  expectation: LayoutExpectation,
  tolerance = 2,
): LayoutFault[] {
  const { clientWidth: width, clientHeight: height } = audit
  if (audit.minimized || width < MIN_USABLE_WIDTH || height < MIN_USABLE_HEIGHT) return []
  const faults: LayoutFault[] = []
  const find = (label: string) => audit.hosts.find((host) => host.label === label)
  const rect = (host: HostRect): Rectangle => ({ x: host.x, y: host.y, width: host.width, height: host.height })
  const full = `0,0 ${width}x${height}`
  const fullRect: Rectangle = { x: 0, y: 0, width, height }
  // The overlay keeps the height it has (collapsed strip or preview) when it is a valid one.
  const stripHeight = Math.min(height, COLLAPSED_STRIP_PX)
  const overlayFix = (current: number): Rectangle => ({
    x: 0,
    y: 0,
    width,
    height: current >= 1 && current <= height ? current : stripHeight,
  })

  const tab = find(expectation.activeTabLabel)
  if (!tab) {
    faults.push({ label: expectation.activeTabLabel, reason: 'missing', expected: full, actual: null, fix: fullRect })
  } else if (!tab.visible) {
    faults.push({ label: tab.label, reason: 'hidden', expected: full, actual: rect(tab), fix: fullRect })
  } else if (
    !near(tab.x, 0, tolerance) || !near(tab.y, 0, tolerance) ||
    !near(tab.width, width, tolerance) || !near(tab.height, height, tolerance)
  ) {
    faults.push({ label: tab.label, reason: 'offset-or-size', expected: full, actual: rect(tab), fix: fullRect })
  }

  // The overlay can legitimately be hidden (suppressed while a dialog owns the window) or not created yet,
  // so only its geometry is judged, and only while it is shown.
  const chrome = find(expectation.chromeLabel)
  if (
    chrome?.visible && (
      !near(chrome.x, 0, tolerance) || !near(chrome.y, 0, tolerance) ||
      !near(chrome.width, width, tolerance) ||
      chrome.height < 1 || chrome.height > height + tolerance
    )
  ) {
    faults.push({ label: chrome.label, reason: 'offset-or-size', expected: `0,0 ${width}xN (N 1..${height})`, actual: rect(chrome), fix: overlayFix(chrome.height) })
  }

  // A webview that draws at another scale than its window (a monitor switched off, a lid closed, the
  // window moved to a monitor with another scale) keeps the right rectangle but shows the page at the
  // wrong size, so only the scale tells. Hidden webviews are not judged: they get theirs when shown.
  const dpi = audit.windowDpi ?? 0
  if (dpi > 0) {
    const scale = dpi / 96
    for (const host of audit.hosts) {
      const raster = host.rasterScale ?? 0
      if (!host.visible || raster <= 0 || Math.abs(raster - scale) <= 0.01) continue
      faults.push({ label: host.label, reason: 'scale', expected: `scale ${scale}`, actual: rect(host), fix: rect(host), seen: raster })
    }
  }

  const main = find(expectation.mainLabel)
  if (main && (
    !near(main.x, 0, tolerance) || !near(main.y, 0, tolerance) ||
    !near(main.width, width, tolerance) || !near(main.height, height, tolerance)
  )) {
    faults.push({ label: main.label, reason: 'offset-or-size', expected: full, actual: rect(main), fix: fullRect })
  }
  return faults
}

export interface LayoutAuditorOptions {
  intervalMs: number
  /** How many audits in a row must show the same difference before it counts. */
  confirmations: number
  /** After a repair is requested, wait this long before another one can be. */
  cooldownMs: number
  /** Faults found now, or null when the window is in a state that is not judged (Home, minimized, fullscreen...). */
  read(): Promise<LayoutFault[] | null>
  onFault(faults: LayoutFault[]): void | Promise<void>
  now(): number
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

const fingerprint = (faults: LayoutFault[]) =>
  JSON.stringify(faults.map((fault) => [fault.label, fault.reason, fault.actual, fault.seen ?? null]))

/**
 * Looks every `intervalMs`. A difference counts when it is the SAME one `confirmations` audits in a
 * row (a window being dragged or restored shows a different one each time), and a repair is requested
 * at most once per cooldown.
 */
export function createLayoutAuditor(options: LayoutAuditorOptions) {
  let timer: unknown = null
  let stopped = true
  let streak = 0
  let last = ''
  let cooldownUntil = 0
  let running = false

  async function tick(): Promise<void> {
    if (running) return
    running = true
    try {
      const faults = await options.read()
      if (!faults || faults.length === 0) {
        streak = 0
        last = ''
        return
      }
      const current = fingerprint(faults)
      streak = current === last ? streak + 1 : 1
      last = current
      if (streak >= options.confirmations && options.now() >= cooldownUntil) {
        streak = 0
        last = ''
        cooldownUntil = options.now() + options.cooldownMs
        await options.onFault(faults)
      }
    } catch {
      // An audit that cannot be read is not a fault.
      streak = 0
      last = ''
    } finally {
      running = false
    }
  }

  function schedule(): void {
    if (stopped) return
    timer = options.setTimer(() => {
      timer = null
      void tick().finally(schedule)
    }, options.intervalMs)
  }

  return {
    tick,
    start(): void {
      if (!stopped) return
      stopped = false
      schedule()
    },
    stop(): void {
      stopped = true
      if (timer !== null) options.clearTimer(timer)
      timer = null
    },
  }
}
