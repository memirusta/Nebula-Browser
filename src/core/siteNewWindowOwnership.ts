/**
 * A page asking for a new tab or window (target="_blank", window.open) is announced to every Nebula window,
 * because the native side emits it application-wide. Only the window that owns the page that asked may act on it;
 * otherwise a link clicked in one window opens its tab in all of them.
 */
export interface NewWindowOpener {
  /** True when the opener is a tab webview (of any window). */
  isTabLabel: boolean
  /** True when the opener is the content of a site popup (of any window). */
  isPopupLabel: boolean
  /** True when the opener is one of this window's own tabs. */
  ownsTab: boolean
  /** True when the opener is the content of a popup this window created. */
  ownsPopup: boolean
}

export function windowHandlesNewWindowRequest({ isTabLabel, isPopupLabel, ownsTab, ownsPopup }: NewWindowOpener): boolean {
  if (isTabLabel) return ownsTab
  if (isPopupLabel) return ownsPopup
  // Neither a tab nor a popup (an extension page, for instance): there is no owner to find, so it is handled as it
  // always was.
  return true
}
