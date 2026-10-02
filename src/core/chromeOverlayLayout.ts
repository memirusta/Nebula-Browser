interface ChromeOverlayState {
  siteInfoOpen: boolean
  privateInfoOpen: boolean
  extensionsOpen?: boolean
  tabSearchOpen: boolean
  isBrowsing: boolean
  hasZoom: boolean
  hasSensitiveUsage: boolean
}

/** Reserve native WebView height for floating panels without resizing the page. */
export function chromeOverlayMinimumHeight(state: ChromeOverlayState): number {
  if (state.siteInfoOpen || state.privateInfoOpen || state.extensionsOpen || state.tabSearchOpen) return 650
  if (!state.isBrowsing) return 0
  if (state.hasZoom && state.hasSensitiveUsage) return 138
  return state.hasZoom || state.hasSensitiveUsage ? 78 : 0
}
