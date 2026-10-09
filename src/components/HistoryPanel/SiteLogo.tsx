import { useEffect, useRef } from 'react'
import { cachedFaviconForUrl, ensureFavicon } from '../../core/faviconCache'

interface SiteLogoProps {
  url: string
  /** What was stored with the entry; only an icon that is already data on this machine is used. */
  stored?: string
  /** The letter shown until the site's icon is kept. */
  letter: string
  className: string
  fallbackClassName: string
}

/**
 * The logo of a site in a long list: the kept icon, or the one stored with the entry when it is
 * data, or a letter. A site that has no kept icon is asked for (see faviconCache) only once its row
 * is on screen, so opening a history of hundreds of sites does not ask for hundreds of icons at once
 * and never shows a request to a favicon service for a row nobody looked at. The panel that uses it
 * calls useFaviconRefresh, so the row is drawn again when the icon arrives.
 */
export function SiteLogo({ url, stored, letter, className, fallbackClassName }: SiteLogoProps) {
  const own = stored?.startsWith('data:image/') ? stored : null
  const source = own ?? cachedFaviconForUrl(url)
  const holder = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (source) return
    const element = holder.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      void ensureFavicon(url)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect()
        void ensureFavicon(url)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [source, url])

  if (source) return <img className={className} src={source} alt="" draggable={false} />
  return (
    <span ref={holder} className={fallbackClassName} aria-hidden="true">
      {letter}
    </span>
  )
}
