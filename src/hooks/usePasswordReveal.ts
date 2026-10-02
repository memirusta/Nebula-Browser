import { useCallback, useEffect, useRef, useState } from 'react'
import type { SavedPassword } from '../core/passwordVaultSchema'
import { verifyPasswordReveal } from '../platform/passwordReveal'

export const PASSWORD_REVEAL_TIMEOUT_MS = 60_000

export function usePasswordReveal(entries: SavedPassword[], message: string, onLock?: () => void) {
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map())
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<'unavailable' | 'failed' | 'clipboard' | null>(null)
  const entriesRef = useRef(entries)
  const mounted = useRef(true)
  const verifying = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onLockRef = useRef(onLock)
  useEffect(() => { onLockRef.current = onLock }, [onLock])

  const lock = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    if (!mounted.current) return
    setRevealed(new Map())
    onLockRef.current?.()
  }, [])

  useEffect(() => { entriesRef.current = entries }, [entries])
  useEffect(() => {
    mounted.current = true
    const onVisibility = () => { if (document.visibilityState === 'hidden') lock() }
    window.addEventListener('blur', lock)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      mounted.current = false
      if (timer.current !== null) clearTimeout(timer.current)
      window.removeEventListener('blur', lock)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [lock])

  const authorize = useCallback(async (entry: SavedPassword): Promise<boolean> => {
    if (verifying.current) return false
    verifying.current = true
    setPendingId(entry.id)
    setError(null)
    try {
      const result = await verifyPasswordReveal(message)
      if (!mounted.current || document.visibilityState === 'hidden') return false
      const current = entriesRef.current.find((item) => item.id === entry.id)
      // A delayed approval never authorizes a replaced or deleted credential.
      if (!current || current.password !== entry.password || current.updatedAt !== entry.updatedAt) return false
      if (result.verified !== true) {
        if (result.reason !== 'cancelled') setError(result.reason === 'unavailable' ? 'unavailable' : 'failed')
        return false
      }
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(lock, PASSWORD_REVEAL_TIMEOUT_MS)
      return true
    } catch {
      if (mounted.current) setError('failed')
      return false
    } finally {
      verifying.current = false
      if (mounted.current) setPendingId(null)
    }
  }, [message, lock])

  const isRevealed = (entry: SavedPassword) => revealed.get(entry.id) === entry.password

  const toggleReveal = async (entry: SavedPassword) => {
    if (isRevealed(entry)) {
      setRevealed((current) => {
        const next = new Map(current)
        next.delete(entry.id)
        return next
      })
      return
    }
    if (await authorize(entry) && mounted.current) {
      setRevealed((current) => new Map(current).set(entry.id, entry.password))
    }
  }

  const copyPassword = async (entry: SavedPassword) => {
    if (!await authorize(entry) || !mounted.current) return
    try {
      await navigator.clipboard.writeText(entry.password)
    } catch {
      if (mounted.current) setError('clipboard')
    }
  }

  return { authorize, isRevealed, toggleReveal, copyPassword, pendingId, error, lock }
}
