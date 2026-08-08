import type { WidgetPane, WidgetPaneData } from '../../core/widgets'
import type { SystemStats } from '../../core/types'
import { BlankWidget } from './BlankWidget'
import { ClockWidget } from './ClockWidget'
import { CpuWidget } from './CpuWidget'
import { NotesWidget } from './NotesWidget'
import { RamWidget } from './RamWidget'
import { WeatherWidget } from './WeatherWidget'
import { CalendarWidget } from './CalendarWidget'
import { QuickLinksWidget } from './QuickLinksWidget'
import { NetworkWidget } from './NetworkWidget'

interface WidgetRendererProps {
  pane: WidgetPane
  stats: SystemStats
  onUpdate: (data: WidgetPaneData) => void
  onNavigate: (url: string) => void
}

export function WidgetRenderer({ pane, stats, onUpdate, onNavigate }: WidgetRendererProps) {
  const update = (patch: WidgetPaneData) => onUpdate({ ...pane.data, ...patch })
  switch (pane.widgetType) {
    case 'ram':
      return <RamWidget stats={stats} />
    case 'cpu':
      return <CpuWidget stats={stats} />
    case 'clock':
      return <ClockWidget />
    case 'blank':
      return <BlankWidget value={pane.data?.blank} onChange={(blank) => update({ blank })} />
    case 'notes':
      return <NotesWidget value={pane.data?.notes?.text ?? ''} onChange={(text) => update({ notes: { text } })} />
    case 'weather':
      return <WeatherWidget value={pane.data?.weather} onChange={(weather) => update({ weather })} />
    case 'calendar':
      return <CalendarWidget />
    case 'quickLinks':
      return <QuickLinksWidget value={pane.data?.quickLinks?.links ?? []} onChange={(links) => update({ quickLinks: { links } })} onNavigate={onNavigate} />
    case 'network':
      return <NetworkWidget />
    default:
      return <BlankWidget />
  }
}
