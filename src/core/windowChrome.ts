/** Hover strip for the collapsed Semi-Lunar trigger. */
export const SEMI_LUNAR_HIT_ZONE_HEIGHT = 10

/** Padding below expanded Semi-Lunar dome. */
export const BROWSING_LUNAR_CHROME_PADDING = 12

/** Extra height when a folder panel is open below the dome. */
export const BROWSING_FOLDER_PANEL_HEIGHT = 280

export function browsingChromeBelowTitlePx(
  isExpanded: boolean,
  lunarHeightPx: number,
  folderOpen: boolean,
): number {
  let chrome = isExpanded
    ? lunarHeightPx + BROWSING_LUNAR_CHROME_PADDING
    : SEMI_LUNAR_HIT_ZONE_HEIGHT

  if (folderOpen) {
    chrome += BROWSING_FOLDER_PANEL_HEIGHT
  }

  return chrome
}
