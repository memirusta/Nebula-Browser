import { useCallback, useEffect, useState } from 'react'
import type { SystemStats } from '../core/types'
import { showAppAlert } from '../core/appDialog'
import { getIntlLocale, loadLocale } from '../core/locale'
import { useLocale } from './useLocale'
import { SingleFlightPoll } from '../core/singleFlightPoll'
import { isTauri } from '../platform/runtime'
import { fetchSystemStats } from '../platform/systemStats'
import {
  clearWallpaper,
  fileToStorableWallpaper,
  loadWallpaper,
  persistWallpaper,
} from '../core/wallpaperStorage'

const HISTORY_LEN = 40
const POLL_MS = 3000

const MOCK_STATS: SystemStats = {
  ramPercent: 4,
  ramUsedGb: 0.6,
  ramTotalGb: 16,
  cpuPercent: 3,
  ramHistory: Array(HISTORY_LEN).fill(4),
  cpuHistory: Array(HISTORY_LEN).fill(3),
}

function pushHistory(prev: number[], value: number) {
  return [...prev.slice(-(HISTORY_LEN - 1)), value]
}

function withHistory(prev: SystemStats, snapshot: Omit<SystemStats, 'ramHistory' | 'cpuHistory'>): SystemStats {
  return {
    ...snapshot,
    ramHistory: pushHistory(prev.ramHistory, snapshot.ramPercent),
    cpuHistory: pushHistory(prev.cpuHistory, snapshot.cpuPercent),
  }
}

function nextMockStats(prev: SystemStats): SystemStats {
  const ramPercent = Math.min(12, Math.max(2, prev.ramPercent + (Math.random() - 0.5) * 1.2))
  const cpuPercent = Math.min(18, Math.max(1, prev.cpuPercent + (Math.random() - 0.5) * 4))
  const ramUsedGb = (ramPercent / 100) * prev.ramTotalGb

  return withHistory(prev, {
    ramPercent: Math.round(ramPercent),
    cpuPercent: Math.round(cpuPercent),
    ramUsedGb: Math.round(ramUsedGb * 10) / 10,
    ramTotalGb: prev.ramTotalGb,
  })
}

export function useSystemStats(enabled = true) {
  const [stats, setStats] = useState<SystemStats>(MOCK_STATS)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const clearScheduledPoll = () => {
      if (!timer) return
      clearTimeout(timer)
      timer = undefined
    }

    const pollOnce = async () => {
      if (cancelled || document.hidden) return

      if (!isTauri) {
        setStats((prev) => nextMockStats(prev))
        return
      }

      const snapshot = await fetchSystemStats()
      if (!cancelled && snapshot) {
        setStats((prev) => withHistory(prev, snapshot))
      }
    }

    const poller = new SingleFlightPoll(pollOnce, (run) => {
      if (cancelled) return
      clearScheduledPoll()
      timer = setTimeout(() => {
        timer = undefined
        run()
      }, POLL_MS)
    })

    const triggerNow = () => {
      if (cancelled || document.hidden) return
      clearScheduledPoll()
      poller.trigger()
    }

    const onVisibility = () => {
      if (document.hidden) return
      triggerNow()
    }

    if (isTauri) {
      triggerNow()
    } else {
      timer = setTimeout(() => {
        timer = undefined
        poller.trigger()
      }, POLL_MS)
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      poller.stop()
      clearScheduledPoll()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled])

  return stats
}

export function useClock() {
  const { locale } = useLocale()
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const delay = 60_050 - (Date.now() % 60_000)
      timer = setTimeout(() => {
        setNow(new Date())
        schedule()
      }, delay)
    }
    const onVisibility = () => {
      if (document.hidden) return
      setNow(new Date())
      if (timer) clearTimeout(timer)
      schedule()
    }
    schedule()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const dateLocale = getIntlLocale(locale)
  const time = now.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
  const date = now.toLocaleDateString(dateLocale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return { time, date }
}

export function useWallpaper() {
  const [wallpaper, setWallpaperState] = useState(loadWallpaper)

  const setWallpaper = useCallback((url: string | null) => {
    if (url && !persistWallpaper(url)) return false
    if (!url) clearWallpaper()
    setWallpaperState(url)
    return true
  }, [])

  const resetWallpaper = useCallback(() => {
    clearWallpaper()
    setWallpaperState(null)
  }, [])

  const pickWallpaper = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const stored = await fileToStorableWallpaper(file)
      if (stored) setWallpaperState(stored)
      else {
        const message =
          loadLocale() === 'tr'
            ? 'Duvar kağıdı kaydedilemedi. Daha küçük bir görsel deneyin.'
            : 'The wallpaper could not be saved. Try a smaller image.'
        void showAppAlert(message)
      }
    }
    input.click()
  }, [])

  return { wallpaper, setWallpaper, pickWallpaper, resetWallpaper }
}
