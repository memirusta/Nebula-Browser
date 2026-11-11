/**
 * What to show as the icon of a site, wherever Nebula shows one (the dock, tabs, folders, history, the
 * suggestions): the icon the page gave, or the one kept on this machine, or - until one is kept - what
 * was stored for the shortcut, or a letter drawn here.
 *
 * The first time a site has no kept icon it is asked for once in the background (see faviconCache): the
 * site's own `/favicon.ico`; a site with none keeps its letter. From then on the kept icon is used
 * and nothing is requested from anyone for it. A private tab never asks and never uses the cache: a
 * private visit leaves no trace of its site here.
 */
import { faviconForUrl } from './browserTab.ts'
import { usableStoredFavicon } from './faviconPlaceholder.ts'
import { cachedFaviconForUrl, ensureFavicon, faviconHostKey } from './faviconCache.ts'

export function siteIconSource(
  stored: string | null | undefined,
  pageUrl: string,
  options?: { isPrivate?: boolean },
): string {
  // An address of a favicon service stored by an older version, or a placeholder, counts as no icon.
  const own = usableStoredFavicon(stored)
  // What the page itself gave is already on this machine.
  if (own && own.startsWith('data:image/')) return own
  if (options?.isPrivate) return own || faviconForUrl(pageUrl)

  const kept = cachedFaviconForUrl(pageUrl)
  if (kept) return kept

  // Not kept yet: fetch it for next time, and show what there is meanwhile.
  if (faviconHostKey(pageUrl)) void ensureFavicon(pageUrl)
  return own || faviconForUrl(pageUrl)
}
