export const widgetThemes = ['graphite', 'ocean', 'forest', 'dusk'] as const
export type WidgetTheme = typeof widgetThemes[number]
export const widgetThemeLabels: Record<WidgetTheme, string> = {
  graphite: '石墨灰', ocean: '海雾蓝', forest: '松林绿', dusk: '暮紫'
}
export const widgetMaterials = ['acrylic', 'rounded'] as const
export type WidgetMaterial = typeof widgetMaterials[number]

export interface WidgetCity {
  id: number
  name: string
  region: string
  country: string
  latitude: number
  longitude: number
}
export interface WidgetPreferences {
  enabled: boolean
  openAtLogin: boolean
  alwaysOnTop: boolean
  glassOpacity: number
  theme: WidgetTheme
  material: WidgetMaterial
  scale: number | null
  city: WidgetCity | null
  position: { x: number; y: number } | null
  focusText: string
  railOrder: DesktopShortcut[]
  hiddenPanels: DesktopShortcut[]
  attendancePeriod: { startMonth: string; endMonth: string } | null
}
export const desktopShortcuts = ['checkin', 'tasks', 'submissions', 'reading', 'gpu', 'codex'] as const
export type DesktopShortcut = typeof desktopShortcuts[number]
export const desktopPanelTitles = { checkin: '打卡记录', tasks: '任务总览', submissions: '论文投稿', reading: '论文阅读', gpu: 'GPU 监控', codex: 'Codex 额度', more: '便签管理' } as const
export const defaultWidgetPreferences: WidgetPreferences = {
  enabled: true, openAtLogin: true, alwaysOnTop: false, glassOpacity: 0.62, theme: 'graphite', material: 'rounded', scale: null,
  city: null, position: null, focusText: '', railOrder: [...desktopShortcuts], hiddenPanels: [], attendancePeriod: null
}
export type WidgetPreferencesPatch = Partial<Omit<WidgetPreferences, 'position'>>
export type DesktopPanel = DesktopShortcut | 'more'
export interface DesktopNotice {
  id: string
  kind: 'checkin' | 'gpu' | 'cpolar' | 'task'
  title: string
  detail: string
  at: number
}
export interface WidgetSnapshot {
  panel?: DesktopPanel
  preferences: WidgetPreferences
  visible: boolean
  workbenchVisible?: boolean
  startupManaged: boolean
  startupError: string | null
  scale: number
  waterReminderAt: number | null
  notices: DesktopNotice[]
}
export interface WidgetWeather {
  cityId: number
  temperature: number
  code: number
  isDay: boolean
  fetchedAt: number
}
export interface WidgetWeatherSnapshot {
  weather: WidgetWeather | null
  stale: boolean
  error: string | null
}
export const widgetDimensions = { width: 480, height: 720, focusHeight: 320, margin: 0 } as const
export const desktopRailWidth = 512
export const desktopRailTabWidth = 60
export const desktopRailHeight = 536
export interface DesktopReadingStatus {
  queueError?: string
  queued: number
  failed: number
  paused: boolean
  progress: import('./types').TranslationProgress | null
  unread?: number
}
export interface DesktopOverview {
  attendance: { week: number | null; month: number | null }
  tasks: { remaining: number; completedToday: number; totalToday: number }
  submissions: { active: number; dueDays: number | null; title: string | null }
  reading: DesktopReadingStatus
}
export interface DesktopReadingResume { paperId: string; variant: import('./types').PaperVariant; page: number }
export type DesktopLibrarySnapshot = Pick<import('./types').LibrarySnapshot, 'folders' | 'papers' | 'translationProgress' | 'activeTranslationProgress' | 'translationPaused'> & { resume: DesktopReadingResume | null; translationQueueError: string }
