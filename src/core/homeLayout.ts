import type { HomeSettings } from './nebulaSettings'

export type ModuleSize = 's' | 'm' | 'l'

export interface ModuleOffset {
  x: number
  y: number
}

export const MODULE_OFFSET_BOUNDS = { x: 420, y: 320 }

export function clampModuleOffset(x: number, y: number): ModuleOffset {
  return {
    x: Math.round(
      Math.min(MODULE_OFFSET_BOUNDS.x, Math.max(-MODULE_OFFSET_BOUNDS.x, x)),
    ),
    y: Math.round(
      Math.min(MODULE_OFFSET_BOUNDS.y, Math.max(-MODULE_OFFSET_BOUNDS.y, y)),
    ),
  }
}

export const ZERO_OFFSET: ModuleOffset = { x: 0, y: 0 }

export interface HomeLayoutModule {
  visible: boolean
  size?: ModuleSize
}

export interface HomeLayout {
  pinnedStrip: HomeLayoutModule & { size: ModuleSize }
  search: HomeLayoutModule & { size: ModuleSize; offset: ModuleOffset }
  profile: HomeLayoutModule & { offset: ModuleOffset }
  widgets: HomeLayoutModule
  clock: HomeLayoutModule
  toolbar: HomeLayoutModule
}

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  pinnedStrip: { visible: true, size: 'm' },
  search: { visible: true, size: 'm', offset: ZERO_OFFSET },
  profile: { visible: true, offset: ZERO_OFFSET },
  widgets: { visible: true },
  clock: { visible: true },
  toolbar: { visible: true },
}

export function homeLayoutFromSettings(home: HomeSettings): HomeLayout {
  return {
    pinnedStrip: {
      visible: home.showPinnedStrip,
      size: home.pinnedStripSize,
    },
    search: {
      visible: true,
      size: home.searchSize,
      offset: clampModuleOffset(home.searchOffsetX, home.searchOffsetY),
    },
    profile: {
      visible: home.showProfile,
      offset: clampModuleOffset(home.profileOffsetX, home.profileOffsetY),
    },
    widgets: { visible: home.showSystemWidgets },
    clock: { visible: home.showClock },
    toolbar: { visible: home.showToolbar },
  }
}

export function applyHomeLayoutToSettings(
  home: HomeSettings,
  layout: HomeLayout,
): HomeSettings {
  return {
    ...home,
    showPinnedStrip: layout.pinnedStrip.visible,
    pinnedStripSize: layout.pinnedStrip.size,
    searchSize: layout.search.size,
    searchOffsetX: layout.search.offset.x,
    searchOffsetY: layout.search.offset.y,
    showProfile: layout.profile.visible,
    profileOffsetX: layout.profile.offset.x,
    profileOffsetY: layout.profile.offset.y,
    showGreeting: layout.profile.visible,
    showSystemWidgets: layout.widgets.visible,
    showClock: layout.clock.visible,
    showToolbar: layout.toolbar.visible,
  }
}

export const MODULE_SIZE_SCALE: Record<ModuleSize, number> = {
  s: 0.88,
  m: 1,
  l: 1.12,
}

export const SEARCH_SIZE_WIDTH: Record<ModuleSize, string> = {
  s: 'min(440px, 84vw)',
  m: 'min(520px, 92vw)',
  l: 'min(600px, 96vw)',
}
