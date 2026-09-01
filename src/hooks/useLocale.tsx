/* eslint-disable react/only-export-components -- provider and hook intentionally share one context */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  loadLocale,
  isNebulaLocale,
  saveLocale,
  t as translate,
  tf as translateFormat,
  type LocaleMessageKey,
  type NebulaLocale,
} from '../core/locale'
import {
  listenUiLocaleChanges,
  syncNativeUiLocale,
} from '../platform/tauriLocale'

interface LocaleContextValue {
  locale: NebulaLocale
  setLocale: (locale: NebulaLocale) => void
  t: (key: LocaleMessageKey) => string
  tf: (key: LocaleMessageKey, vars: Record<string, string | number>) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<NebulaLocale>(() => loadLocale())

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void listenUiLocaleChanges((next) => {
      if (disposed || !isNebulaLocale(next)) return
      saveLocale(next)
      setLocaleState((current) => (current === next ? current : next))
    })
      .then((dispose) => {
        if (disposed) {
          dispose()
          return
        }
        unlisten = dispose
      })
      .catch((error: unknown) => {
        if (import.meta.env.DEV) {
          console.warn('[nebula] Failed to listen for UI locale changes', error)
        }
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
    void syncNativeUiLocale(locale)
  }, [locale])

  const setLocale = useCallback((next: NebulaLocale) => {
    saveLocale(next)
    setLocaleState(next)
  }, [])

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: (key: LocaleMessageKey) => translate(locale, key),
      tf: (key: LocaleMessageKey, vars: Record<string, string | number>) =>
        translateFormat(locale, key, vars),
    }),
    [locale, setLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export type { NebulaLocale } from '../core/locale'

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    throw new Error('useLocale must be used within LocaleProvider')
  }
  return ctx
}
