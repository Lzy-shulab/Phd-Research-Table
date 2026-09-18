import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useInterface } from '../../stores/interface'

export function WorkspaceBackground() {
  const { preferences, backgroundDataUrl } = useInterface()
  const reduced = useReducedMotion()
  const style = preferences.background === 'custom' && !backgroundDataUrl ? 'default' : preferences.background
  return <div className="workspace-background" aria-hidden="true">
    <AnimatePresence initial={false}>
      <motion.div key={`${style}-${style === 'custom' ? preferences.backgroundFile : ''}`}
        className={`workspace-wallpaper wallpaper-${style}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ type: 'tween', duration: reduced ? 0 : 0.2 }}
        style={style === 'custom' && backgroundDataUrl ? { backgroundImage: `url("${backgroundDataUrl}")` } : undefined} />
    </AnimatePresence>
    <div className="wallpaper-scrim" />
  </div>
}
