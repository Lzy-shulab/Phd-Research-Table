import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { reducedDesktopMotion } from './desktop-motion'

export function DesktopTabs({ label, selected, className = '', children }: {
  label: string; selected: string; className?: string; children: ReactNode
}) {
  const group = useRef<HTMLDivElement>(null)
  const marker = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const root = group.current!
    const indicator = marker.current!
    const active = root.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')
    if (!active) return
    const bounds = () => ({ x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight })
    const animate = root.dataset.placed === 'true' && !reducedDesktopMotion()
    const initial = bounds()
    const tween = animate ? gsap.to(indicator, { ...initial, duration: .22, ease: 'power3.out', overwrite: true }) : null
    if (!tween) gsap.set(indicator, initial)
    root.dataset.placed = 'true'

    let previous = initial
    const observer = new ResizeObserver(() => {
      const next = bounds()
      if (next.x === previous.x && next.y === previous.y && next.width === previous.width && next.height === previous.height) return
      previous = next
      gsap.killTweensOf(indicator)
      gsap.set(indicator, next)
    })
    observer.observe(root)
    for (const tab of root.querySelectorAll('[role=tab]')) observer.observe(tab)
    return () => { observer.disconnect(); tween?.kill() }
  }, [selected])

  return <div ref={group} className={`desktop-tabs desktop-sliding-tabs ${className}`} role="tablist" aria-label={label}>
    <span className="desktop-tab-indicator" aria-hidden="true" ref={marker}/>{children}
  </div>
}
