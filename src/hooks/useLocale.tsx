import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  loadLocale,
  saveLocale,
  t as translate,
  tf as translateFormat,
  type LocaleMessageKey,
  type NebulaLocale,
} from '../core/locale'

interface LocaleContextValue {
  locale: NebulaLocale
  setLocale: (locale: NebulaLocale) => void
  t: (key: LocaleMessageKey) => string
  tf: (key: LocaleMessageKey, vars: Record<string, string | number>) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<NebulaLocale>(() => loadLocale())

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
