export const POPUP_WINDOW_PREFIX = 'nebula-popup-window-'
export const POPUP_CHROME_PREFIX = 'nebula-popup-chrome-'
export const POPUP_CONTENT_PREFIX = 'nebula-popup-content-'

export function isPopupContentLabel(label: string): boolean {
  return label.startsWith(POPUP_CONTENT_PREFIX)
}
