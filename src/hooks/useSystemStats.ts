import { useCallback, useEffect, useState } from 'react'
import type { SystemStats } from '../core/types'
import { isTauri } from '../platform/runtime'
import { fetchSystemStats } from '../platform/systemStats'
import {
  clearWallpaper,
  fileToStorableWallpaper,
  loadWallpaper,
  persistWallpaper,
} from '../core/wallpaperStorage'

const HISTORY_LEN = 40
const POLL_MS = 1200

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

export function useSystemStats() {
  const [stats, setStats] = useState<SystemStats>(MOCK_STATS)

  useEffect(() => {
    if (!isTauri) {
      const interval = setInterval(() => {
        setStats((prev) => nextMockStats(prev))
      }, POLL_MS)
      return () => clearInterval(interval)
    }

    let cancelled = false

    const poll = async () => {
      const snapshot = await fetchSystemStats()
      if (cancelled || !snapshot) return
      setStats((prev) => withHistory(prev, snapshot))
    }

    void poll()
    const interval = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return stats
}

export function useClock() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const time = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  const date = now.toLocaleDateString('tr-TR', {
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
      else window.alert('Duvar kağıdı kaydedilemedi. Daha küçük bir görsel deneyin.')
    }
    input.click()
  }, [])

  return { wallpaper, setWallpaper, pickWallpaper, resetWallpaper }
}
