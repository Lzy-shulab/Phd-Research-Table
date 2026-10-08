import { useEffect } from 'react'
import { useWorkbench } from '../stores/workbench'
import { useInterface } from '../stores/interface'
import { interfacePalette } from '../../shared/palette'
export function useAppearance() {
  const appearance = useWorkbench((s) => s.appearance)
  const ready = useWorkbench((s) => s.ready)
  const preferences = useInterface((s) => s.preferences)
  const backgroundDataUrl = useInterface((s) => s.backgroundDataUrl)
  const loadInterface = useInterface((s) => s.load)
  useEffect(() => { if (ready) void loadInterface() }, [ready, loadInterface])
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--interface-font-size', `${preferences.fontSize}px`)
    root.style.setProperty('--panel-opacity', `${preferences.panelOpacity}%`)
    root.style.setProperty('--card-opacity', `${Math.round(preferences.panelOpacity * 0.45)}%`)
    root.dataset.textSize = String(preferences.fontSize)
    root.dataset.background = preferences.background === 'custom' && !backgroundDataUrl ? 'default' : preferences.background
    root.dataset.density = preferences.compactMode ? 'compact' : 'comfortable'
    root.dataset.sidebar = preferences.sidebarCollapsed ? 'collapsed' : 'expanded'
    root.dataset.encouragement = preferences.encouragementHidden ? 'hidden' : 'shown'
    root.dataset.dock = preferences.dockAutoHide ? 'auto-hide' : 'pinned'
  }, [preferences.fontSize, preferences.panelOpacity, preferences.background, preferences.compactMode, preferences.sidebarCollapsed, preferences.encouragementHidden, preferences.dockAutoHide, backgroundDataUrl])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    let customTone: [number, number] | undefined
    let disposed = false
    const update = () => {
      const theme = appearance === 'system' ? (media.matches ? 'dark' : 'light') : appearance
      const root = document.documentElement
      root.dataset.theme = theme
      const palette = interfacePalette(preferences.background, theme === 'dark', customTone)
      for (const [name, value] of Object.entries(palette.variables)) root.style.setProperty(name, value)
      void window.workbench.setWindowPalette({ background: palette.base, foreground: palette.text })
    }
    update()
    if (preferences.background === 'custom' && backgroundDataUrl) {
      const image = new Image()
      image.onload = () => {
        if (disposed) return
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8
        const context = canvas.getContext('2d'); if (!context) return
        context.drawImage(image, 0, 0, 8, 8)
        const pixels = context.getImageData(0, 0, 8, 8).data
        const rgb = [0, 0, 0]
        for (let index = 0; index < pixels.length; index += 4) for (let channel = 0; channel < 3; channel++) rgb[channel]! += pixels[index + channel]! / (64 * 255)
        const [red, green, blue] = rgb as [number, number, number], max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min
        if (delta > 0.015) {
          const hue = ((max === red ? (green - blue) / delta : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4) * 60 + 360) % 360
          customTone = [hue, Math.min(34, Math.max(12, delta / (1 - Math.abs(max + min - 1)) * 100))]
          update()
        }
      }
      image.src = backgroundDataUrl
    }
    media.addEventListener('change', update)
    return () => { disposed = true; media.removeEventListener('change', update) }
  }, [appearance, preferences.background, backgroundDataUrl])
}
