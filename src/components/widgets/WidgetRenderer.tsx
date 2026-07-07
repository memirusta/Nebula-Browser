import type { WidgetType } from '../../core/widgets'
import type { SystemStats } from '../../core/types'
import { BlankWidget } from './BlankWidget'
import { ClockWidget } from './ClockWidget'
import { CpuWidget } from './CpuWidget'
import { NotesWidget } from './NotesWidget'
import { RamWidget } from './RamWidget'

interface WidgetRendererProps {
  type: WidgetType
  stats: SystemStats
}

export function WidgetRenderer({ type, stats }: WidgetRendererProps) {
  switch (type) {
    case 'ram':
      return <RamWidget stats={stats} />
    case 'cpu':
      return <CpuWidget stats={stats} />
    case 'clock':
      return <ClockWidget />
    case 'blank':
      return <BlankWidget />
    case 'notes':
      return <NotesWidget />
    default:
      return <BlankWidget />
  }
}
