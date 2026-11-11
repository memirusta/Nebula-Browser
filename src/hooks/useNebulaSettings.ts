import { startTransition, useCallback, useEffect, useState } from 'react'
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
import { shareUnchanged } from '../core/shareUnchanged'

export type { NebulaSettings }
export { DEFAULT_NEBULA_SETTINGS }

/**
 * Choosing a colour is shown on the page at once (Settings does that), and saving it redraws the whole shell, which is
 * slow. Saved as a transition, the redraw gives way to what the person is doing meanwhile instead of freezing it.
 */
const COLOUR_KEYS: ReadonlySet<PropertyKey> = new Set(['accentColor', 'goldColor', 'neutralHue', 'neutralSat'])

export function useNebulaSettings() {
  const [settings, setSettings] = useState<NebulaSettings>(loadNebulaSettings)

  const reloadSettings = useCallback(() => {
    const next = loadNebulaSettings()
    setSettings((prev) => shareUnchanged(prev, next))
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
      const save = () =>
        setSettings((prev) =>
          shareUnchanged(
            prev,
            normalizeNebulaSettings({
              ...prev,
              [category]: { ...prev[category], [key]: value },
            }),
          ),
        )
      if (category === 'appearance' && COLOUR_KEYS.has(key)) startTransition(save)
      else save()
    },
    [],
  )

  const resetCategory = useCallback((category: keyof NebulaSettings) => {
    setSettings((prev) =>
      shareUnchanged(
        prev,
        normalizeNebulaSettings({
          ...prev,
          [category]: DEFAULT_NEBULA_SETTINGS[category],
        }),
      ),
    )
  }, [])

  const resetAll = useCallback(() => {
    setSettings((prev) => shareUnchanged(prev, { ...DEFAULT_NEBULA_SETTINGS }))
  }, [])

  const togglePreviewOnHover = useCallback(() => {
    setSettings((prev) =>
      shareUnchanged(
        prev,
        normalizeNebulaSettings({
          ...prev,
          semiLunar: { ...prev.semiLunar, previewOnHover: !prev.semiLunar.previewOnHover },
        }),
      ),
    )
  }, [])

  const applyHomeLayout = useCallback((layout: HomeLayout) => {
    setSettings((prev) =>
      shareUnchanged(
        prev,
        normalizeNebulaSettings({
          ...prev,
          home: applyHomeLayoutToSettings(prev.home, layout),
        }),
      ),
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
