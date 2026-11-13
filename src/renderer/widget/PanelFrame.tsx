import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { PushPin as Pin, X, CheckCircle, ListChecks, PaperPlaneTilt, BookOpenText, Cpu, Gauge, DotsThree } from '@phosphor-icons/react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { CustomEase } from 'gsap/CustomEase'
import { defaultWidgetPreferences, type WidgetSnapshot } from '../../shared/widget'
import { unwrap } from './api'
gsap.registerPlugin(useGSAP, CustomEase)
CustomEase.create('desktop-settle', '.22,1,.36,1')

export function PanelFrame({ title, children, footer, busy = false, covered = false }: { title: string; children: ReactNode; footer?: ReactNode; busy?: boolean; covered?: boolean }) {
  const [snapshot, setSnapshot] = useState<WidgetSnapshot>()
  const [error, setError] = useState('')
  const root = useRef<HTMLElement>(null)
  const closing = useRef(false)
  const ready = useRef(false)
  const { contextSafe } = useGSAP((context, safe) => {
    void context
    const enter = safe!(() => {
      closing.current = false
      gsap.killTweensOf(root.current)
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
      gsap.fromTo(root.current, { opacity: reduced ? 1 : .9, x: reduced ? 0 : 12 },
        { opacity: 1, x: 0, duration: reduced ? 0 : .22, ease: 'power3.out', force3D: true, clearProps: 'transform,opacity,willChange' })
    })
    gsap.set(root.current, { willChange: 'transform,opacity' })
    return window.workbench.onDesktopPanelShown(enter)
  }, { scope: root })
  const collapse = contextSafe(() => {
    if (closing.current) return
    closing.current = true
    gsap.killTweensOf(root.current)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    gsap.to(root.current, { opacity: reduced ? 1 : .9, x: reduced ? 0 : 12, duration: reduced ? 0 : .14, ease: 'power2.in', force3D: true,
      onComplete: () => { void window.workbench.hideWidget(); closing.current = false } })
  })
  const Icon = title === '任务总览' ? ListChecks : title === '论文投稿' ? PaperPlaneTilt : title === '论文阅读' ? BookOpenText : title === 'GPU 监控' ? Cpu : title === 'Codex 额度' ? Gauge : title === '便签管理' ? DotsThree : CheckCircle
  useEffect(() => {
    void window.workbench.widgetSnapshot().then(unwrap).then(setSnapshot).catch(e => setError(String(e)))
    return window.workbench.onWidgetChanged(setSnapshot)
  }, [])
  const preferences = snapshot?.preferences ?? defaultWidgetPreferences
  const initialized = Boolean(snapshot)
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--widget-scale', String(snapshot?.scale ?? 1))
    document.documentElement.style.setProperty('--glass-opacity', String(preferences.glassOpacity))
    document.documentElement.dataset.widgetTheme = preferences.theme
    if (initialized && !ready.current) {
      ready.current = true
      void window.workbench.desktopPanelReady()
    }
  }, [snapshot?.scale, preferences.glassOpacity, preferences.theme, initialized])
  return <main ref={root} className="desktop-panel" data-keep-awake={busy} inert={covered} aria-hidden={covered}>
    <header className="desktop-header"><span className="desktop-feature-icon"><Icon size={24} weight="duotone"/></span><div><strong>{title}</strong><span>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span></div>
      <button aria-label="置顶面板" aria-pressed={preferences.alwaysOnTop} onClick={() => { void window.workbench.updateWidgetPreferences({ alwaysOnTop: !preferences.alwaysOnTop }).then(unwrap).then(setSnapshot).catch(e => setError(String(e))) }}><Pin size={17} /></button>
      <button aria-label="收起面板" onClick={collapse}><X size={20} /></button>
    </header>
    {error && <p role="alert" className="desktop-error">{error}</p>}
    <div className="desktop-panel-content">{children}</div>
    {footer}
  </main>
}
