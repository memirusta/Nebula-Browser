import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_NEBULA_SETTINGS,
  NEBULA_SETTINGS_KEY,
  applyNebulaCssVars,
  loadNebulaSettings,
  normalizeNebulaSettings,
  type NebulaSettings,
} from '../core/nebulaSettings'
import { applyHomeLayoutToSettings, type HomeLayout } from '../core/homeLayout'
import { persistLocalStorage, useStorageSync } from '../core/storageSync'

export type { NebulaSettings }
export { DEFAULT_NEBULA_SETTINGS }

export function useNebulaSettings() {
  const [settings, setSettings] = useState<NebulaSettings>(loadNebulaSettings)

  const reloadSettings = useCallback(() => {
    const next = loadNebulaSettings()
    setSettings(next)
    applyNebulaCssVars(next)
  }, [])

  useStorageSync(NEBULA_SETTINGS_KEY, reloadSettings)

  useEffect(() => {
    persistLocalStorage(NEBULA_SETTINGS_KEY, JSON.stringify(settings))
    applyNebulaCssVars(settings)
  }, [settings])

  const updateCategory = useCallback(
    <C extends keyof NebulaSettings, K extends keyof NebulaSettings[C]>(
      category: C,
      key: K,
      value: NebulaSettings[C][K],
    ) => {
      setSettings((prev) =>
        normalizeNebulaSettings({
          ...prev,
          [category]: { ...prev[category], [key]: value },
        }),
      )
    },
    [],
  )

  const resetCategory = useCallback((category: keyof NebulaSettings) => {
    setSettings((prev) =>
      normalizeNebulaSettings({
        ...prev,
        [category]: DEFAULT_NEBULA_SETTINGS[category],
      }),
    )
  }, [])

  const resetAll = useCallback(() => {
    setSettings({ ...DEFAULT_NEBULA_SETTINGS })
  }, [])

  const togglePreviewOnHover = useCallback(() => {
    setSettings((prev) =>
      normalizeNebulaSettings({
        ...prev,
        semiLunar: { ...prev.semiLunar, previewOnHover: !prev.semiLunar.previewOnHover },
      }),
    )
  }, [])

  const applyHomeLayout = useCallback((layout: HomeLayout) => {
    setSettings((prev) =>
      normalizeNebulaSettings({
        ...prev,
        home: applyHomeLayoutToSettings(prev.home, layout),
      }),
    )
  }, [])

  return {
    settings,
    updateCategory,
    resetCategory,
    resetAll,
    togglePreviewOnHover,
    applyHomeLayout,
  }
}
