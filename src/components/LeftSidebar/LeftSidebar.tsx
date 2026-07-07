import { useState, type ReactNode } from 'react'
import type { HomeSettings } from '../../core/nebulaSettings'
import type { WidgetType } from '../../core/widgets'
import { useLocale } from '../../hooks/useLocale'
import { EditModuleChrome } from '../HomeEdit/EditModuleChrome'
import { SidebarClock } from './SidebarClock'
import { WidgetPickerModal } from './WidgetPickerModal'
import styles from './LeftSidebar.module.css'

interface HomeWidgetSettings {
  showRamWidget: boolean
  showCpuWidget: boolean
}

interface LeftSidebarProps {
  children: ReactNode
  onAddWidget: (type: WidgetType) => void
  activeTypes: Set<WidgetType>
  widgetSettings: HomeWidgetSettings
  clockSettings: Pick<
    HomeSettings,
    | 'showClock'
    | 'clockFontSize'
    | 'clockFontWeight'
    | 'clockShowDate'
    | 'clockFontFamily'
  >
  editMode?: boolean
  editWidgetsVisible?: boolean
  editClockVisible?: boolean
  onEditToggleWidgets?: () => void
  onEditToggleClock?: () => void
}

export function LeftSidebar({
  children,
  onAddWidget,
  activeTypes,
  widgetSettings,
  clockSettings,
  editMode = false,
  editWidgetsVisible = true,
  editClockVisible = true,
  onEditToggleWidgets,
  onEditToggleClock,
}: LeftSidebarProps) {
  const { t } = useLocale()
  const [pickerOpen, setPickerOpen] = useState(false)

  if (!editMode) {
    return (
      <aside className={styles.root}>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setPickerOpen(true)}
          aria-label={t('widgetPickerAria')}
          title={t('widgetPickerAria')}
        >
          +
        </button>

        <div className={styles.gridSlot}>{children}</div>

        {clockSettings.showClock && <SidebarClock settings={clockSettings} />}

        <WidgetPickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onAdd={onAddWidget}
          activeTypes={activeTypes}
          settings={widgetSettings}
        />
      </aside>
    )
  }

  return (
    <aside className={styles.root}>
      <EditModuleChrome
        label={t('systemWidgets')}
        visible={editWidgetsVisible}
        onToggleVisible={onEditToggleWidgets}
        reorderHint
        hidden={!editWidgetsVisible}
      >
        <div className={styles.gridSlot}>{children}</div>
      </EditModuleChrome>

      <EditModuleChrome
        label={t('widgetClock')}
        visible={editClockVisible}
        onToggleVisible={onEditToggleClock}
        hidden={!editClockVisible}
        controlsAtBottom
      >
        {editClockVisible ? (
          <SidebarClock settings={clockSettings} />
        ) : (
          <div className={styles.clockPlaceholder} />
        )}
      </EditModuleChrome>

      <WidgetPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={onAddWidget}
        activeTypes={activeTypes}
        settings={widgetSettings}
      />
    </aside>
  )
}
