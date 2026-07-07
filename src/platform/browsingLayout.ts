import { TITLE_BAR_HEIGHT } from '../core/windowChrome'

const DEFAULT_CHROME_LOGICAL = TITLE_BAR_HEIGHT

let chromeLogicalHeight = DEFAULT_CHROME_LOGICAL

export function getBrowsingChromeLogicalHeight(): number {
  return chromeLogicalHeight
}

export function setBrowsingChromeLogicalHeight(logicalHeight: number): void {
  chromeLogicalHeight = Math.max(TITLE_BAR_HEIGHT, logicalHeight)
}

export function resetBrowsingChromeLogicalHeight(): void {
  chromeLogicalHeight = DEFAULT_CHROME_LOGICAL
}
