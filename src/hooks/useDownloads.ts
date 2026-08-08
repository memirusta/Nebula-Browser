import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  controlDownload,
  downloadProgress,
  isDownloadActive,
  listenDownloads,
  type DownloadAction,
  type DownloadItem,
} from '../core/download'

export function useDownloads() {
  // Deliberately session-only: closing Nebula discards the catalog.
  const [items, setItems] = useState<DownloadItem[]>([])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void listenDownloads((download) => {
      if (disposed) return
      setItems((current) => {
        const index = current.findIndex((item) => item.id === download.id)
        if (index === -1) {
          return [download, ...current]
        }
        const next = [...current]
        next[index] = download
        return next
      })
    }).then((dispose) => {
      if (disposed) {
        dispose()
        return
      }
      unlisten = dispose
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const activeCount = useMemo(() => items.filter(isDownloadActive).length, [items])
  const aggregateProgress = useMemo(() => {
    const active = items.filter(isDownloadActive)
    if (active.length === 0) return null
    const known = active
      .map(downloadProgress)
      .filter((progress): progress is number => progress !== null)
    if (known.length === 0) return null
    return known.reduce((total, progress) => total + progress, 0) / known.length
  }, [items])

  const act = useCallback(async (id: string, action: DownloadAction) => {
    await controlDownload(id, action)
  }, [])

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const clearFinished = useCallback(() => {
    setItems((current) => current.filter(isDownloadActive))
  }, [])

  return {
    items,
    activeCount,
    aggregateProgress,
    act,
    remove,
    clearFinished,
  }
}
