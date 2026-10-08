export const backgroundStyles = ['default', 'mist', 'sage', 'dusk', 'midnight', 'klein', 'orange', 'yellow', 'red', 'pink', 'custom'] as const
export type BackgroundStyle = (typeof backgroundStyles)[number]
export const visualStyles = ['classic'] as const
export type VisualStyle = (typeof visualStyles)[number]
export const fontSizes = [13, 14, 16, 18] as const
export type InterfaceFontSize = (typeof fontSizes)[number]
export interface InterfacePreferences {
  visualStyle: VisualStyle
  background: BackgroundStyle
  fontSize: InterfaceFontSize
  panelOpacity: number
  backgroundFile: string | null
  backgroundName: string
  compactMode: boolean
  sidebarCollapsed: boolean
  encouragementHidden: boolean
  dockAutoHide: boolean
  plannerDisplay: 'notes' | 'list'
  literatureDisplay: 'cards' | 'list'
  publicationDisplay: 'bookcase' | 'list'
}
export type InterfacePatch = Partial<Pick<InterfacePreferences, 'visualStyle' | 'background' | 'fontSize' | 'panelOpacity' | 'compactMode' | 'sidebarCollapsed' | 'encouragementHidden' | 'dockAutoHide' | 'plannerDisplay' | 'literatureDisplay' | 'publicationDisplay'>>
export interface InterfaceSnapshot {
  preferences: InterfacePreferences
  backgroundDataUrl: string | null
}
export const defaultInterfacePreferences: InterfacePreferences = {
  visualStyle: 'classic',
  background: 'default', fontSize: 14, panelOpacity: 95, backgroundFile: null, backgroundName: '',
  compactMode: false, sidebarCollapsed: false, encouragementHidden: false, dockAutoHide: false,
  plannerDisplay: 'notes', literatureDisplay: 'cards', publicationDisplay: 'bookcase'
}
