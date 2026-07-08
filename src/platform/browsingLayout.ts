import { SEMI_LUNAR_HIT_ZONE_HEIGHT } from '../core/windowChrome'

const DEFAULT_CHROME_LOGICAL = SEMI_LUNAR_HIT_ZONE_HEIGHT

let chromeLogicalHeight = DEFAULT_CHROME_LOGICAL

export function getBrowsingChromeLogicalHeight(): number {
  return chromeLogicalHeight
}

export function setBrowsingChromeLogicalHeight(logicalHeight: number): void {
  chromeLogicalHeight = Math.max(SEMI_LUNAR_HIT_ZONE_HEIGHT, logicalHeight)
}

export function resetBrowsingChromeLogicalHeight(): void {
  chromeLogicalHeight = DEFAULT_CHROME_LOGICAL
}
