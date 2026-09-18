import { useEffect } from 'react'
import { useWorkbench } from '../stores/workbench'
import { useInterface } from '../stores/interface'
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
  }, [preferences.fontSize, preferences.panelOpacity, preferences.background, backgroundDataUrl])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => {
      document.documentElement.dataset.theme =
        appearance === 'system' ? (media.matches ? 'dark' : 'light') : appearance
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [appearance])
}
