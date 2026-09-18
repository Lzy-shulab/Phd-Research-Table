export const backgroundStyles = ['default', 'mist', 'sage', 'dusk', 'custom'] as const
export type BackgroundStyle = (typeof backgroundStyles)[number]
export const fontSizes = [13, 14, 16, 18] as const
export type InterfaceFontSize = (typeof fontSizes)[number]
export interface InterfacePreferences {
  background: BackgroundStyle
  fontSize: InterfaceFontSize
  panelOpacity: number
  backgroundFile: string | null
  backgroundName: string
}
export type InterfacePatch = Partial<Pick<InterfacePreferences, 'background' | 'fontSize' | 'panelOpacity'>>
export interface InterfaceSnapshot {
  preferences: InterfacePreferences
  backgroundDataUrl: string | null
}
export const defaultInterfacePreferences: InterfacePreferences = {
  background: 'default', fontSize: 14, panelOpacity: 75, backgroundFile: null, backgroundName: ''
}
