import { useEffect, useRef, useState } from 'react'
import { modules } from '../../app/modules'
import { useWorkbench } from '../../stores/workbench'
import { useInterface } from '../../stores/interface'
import { cn } from '../../lib/utils'
import { useReducedMotion } from 'motion/react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { WorkspaceGlyph } from '../ui/WorkspaceGlyph'

gsap.registerPlugin(useGSAP)

export function Dock() {
  const section = useWorkbench((s) => s.section)
  const setSection = useWorkbench((s) => s.setSection)
  const autoHide = useInterface((s) => s.preferences.dockAutoHide)
  const [revealed, setRevealed] = useState(true)
  const container = useRef<HTMLDivElement>(null)
  const indicator = useRef<HTMLSpanElement>(null)
  const reducedMotion = useReducedMotion()
  const placed = useRef(false)
  const hideTimer = useRef<number | null>(null)
  const cancelHide = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    hideTimer.current = null
  }
  const reveal = () => { cancelHide(); setRevealed(true) }
  const hide = () => {
    cancelHide()
    if (autoHide) hideTimer.current = window.setTimeout(() => {
      if (!container.current?.querySelector(':focus-visible') && !container.current?.matches(':hover')) setRevealed(false)
    }, 260)
  }
  useEffect(() => {
    cancelHide()
    setRevealed(!autoHide)
    return cancelHide
  }, [autoHide])
  useGSAP(() => {
    const selected = container.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')
    if (!selected || !indicator.current) return
    gsap.set(indicator.current, { width: selected.offsetWidth, height: selected.offsetHeight })
    gsap.to(indicator.current, {
      x: selected.offsetLeft, y: selected.offsetTop, opacity: 1,
      duration: !placed.current || reducedMotion ? 0 : 0.38,
      ease: 'power4.out', overwrite: true
    })
    placed.current = true
  }, { scope: container, dependencies: [section, reducedMotion] })
  useGSAP((_context, contextSafe) => {
    const nav = container.current?.querySelector('nav')
    if (!nav) return
    const align = contextSafe!(() => {
      const selected = nav.querySelector<HTMLButtonElement>('[aria-current="page"]')
      if (selected && indicator.current) gsap.set(indicator.current, {
        x: selected.offsetLeft, y: selected.offsetTop,
        width: selected.offsetWidth, height: selected.offsetHeight, opacity: 1, overwrite: true
      })
    })
    const observer = new ResizeObserver(align)
    observer.observe(nav)
    for (const item of nav.querySelectorAll('button')) observer.observe(item)
    return () => observer.disconnect()
  }, { scope: container })
  return (
    <div
      ref={container}
      className={cn('dock-wrap', autoHide && 'dock-auto-hide')}
      data-revealed={!autoHide || revealed ? 'true' : 'false'}
      onPointerEnter={reveal}
      onPointerLeave={hide}
      onFocusCapture={reveal}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) hide() }}
    >
      <span className="dock-reveal-handle" aria-hidden="true" />
      <nav className="dock" aria-label="科研工作空间">
        <span ref={indicator} className="dock-selection" aria-hidden="true" />
        {modules.map((item) => (
          <button
            key={item.id}
            className={cn('dock-item', section === item.id && 'selected')}
            aria-current={section === item.id ? 'page' : undefined}
            onClick={() => setSection(item.id)}
          >
            <WorkspaceGlyph section={item.id} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
