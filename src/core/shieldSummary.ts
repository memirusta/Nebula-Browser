/** What Nebula's shield stopped for the page of a tab: how many, of which kind, and which sites most. */
export interface ShieldPageSummary {
  total: number
  ads: number
  trackers: number
  /** The sites the shield stopped most for the page, the most first. */
  top: { host: string; count: number }[]
}

export const EMPTY_SHIELD_PAGE_SUMMARY: ShieldPageSummary = { total: 0, ads: 0, trackers: 0, top: [] }

export function sameShieldSummary(a: ShieldPageSummary | undefined, b: ShieldPageSummary | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.total === b.total &&
    a.ads === b.ads &&
    a.trackers === b.trackers &&
    a.top.length === b.top.length &&
    a.top.every((host, index) => host.host === b.top[index].host && host.count === b.top[index].count)
  )
}

/** The number on the shield's button: a count that would not fit is cut short. */
export function shieldBadgeText(count: number): string {
  if (count > 99) return '99+'
  return String(Math.max(0, Math.floor(count)))
}
