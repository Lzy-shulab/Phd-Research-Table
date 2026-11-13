import { lazy, useEffect, useRef, useState, type ComponentType } from 'react'
import { flushSync } from 'react-dom'
import type { DesktopPanel } from '../../shared/widget'
import { reducedDesktopMotion } from './desktop-motion'

const loadPanels = {
  more: () => import('./MorePanel').then(m => ({ default: m.MorePanel })),
  tasks: () => import('./TaskPanel').then(m => ({ default: m.TaskPanel })),
  submissions: () => import('./SubmissionPanel').then(m => ({ default: m.SubmissionPanel })),
  reading: () => import('./ReadingPanel').then(m => ({ default: m.ReadingPanel })),
  gpu: () => import('./GpuPanel').then(m => ({ default: m.GpuPanel })),
  codex: () => import('./CodexPanel').then(m => ({ default: m.CodexPanel })),
  checkin: () => import('./WidgetApp').then(m => ({ default: m.WidgetApp }))
}
const initialPanel = new URLSearchParams(location.search).get('panel') as DesktopPanel | null
const initialKind = initialPanel && Object.hasOwn(loadPanels, initialPanel) ? initialPanel : 'checkin'
const InitialPage = lazy(loadPanels[initialKind])

export function Panel() {
  const [{ kind, Page }, setPage] = useState<{ kind: DesktopPanel; Page: ComponentType }>({ kind: initialKind, Page: InitialPage })
  const displayed = useRef(initialKind)
  useEffect(() => {
    let wanted = displayed.current
    let active = true
    let transition: ViewTransition | undefined
    const unsubscribe = window.workbench.onWidgetChanged(({ panel, visible }) => {
      if (!panel || panel === wanted) return
      wanted = panel
      if (panel === displayed.current) { transition?.skipTransition(); return }
      void loadPanels[panel]().then(({ default: NextPage }) => {
        if (!active || panel !== wanted) return
        const commit = () => {
          if (!active || panel !== wanted) return
          displayed.current = panel
          flushSync(() => setPage({ kind: panel, Page: NextPage }))
          const url = new URL(location.href)
          url.searchParams.set('panel', panel)
          history.replaceState(null, '', url)
        }
        if (!visible || reducedDesktopMotion() || !document.startViewTransition) { commit(); return }
        transition = document.startViewTransition(commit)
        void transition.ready.catch(() => {})
      })
    })
    return () => { active = false; transition?.skipTransition(); unsubscribe() }
  }, [])
  return <div data-desktop-page={kind} className="desktop-route"><Page key={kind}/></div>
}
