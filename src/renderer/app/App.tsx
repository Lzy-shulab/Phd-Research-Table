import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import { AlertCircle } from 'lucide-react'
import { useWorkbench } from '../stores/workbench'
import { useTasks } from '../hooks/use-tasks'
import { useAppearance } from '../hooks/use-appearance'
import { Titlebar } from '../components/layout/Titlebar'
import { Sidebar } from '../components/layout/Sidebar'
import { Dock } from '../components/layout/Dock'
import { PlannerWorkspace } from '../components/planner/PlannerWorkspace'
import { TaskInspector } from '../components/planner/TaskInspector'
import { Button } from '../components/ui/button'
import { Toasts } from '../components/ui/toasts'
import { useLibrary } from '../stores/library'
import { useSubmissions } from '../stores/submissions'
import { MetadataQueue } from '../components/literature/MetadataQueue'
import { WorkspaceBackground } from '../components/layout/WorkspaceBackground'
import { useInterface } from '../stores/interface'
import { useAssistant } from '../stores/assistant'
import { AssistantDialog } from '../components/planner/AssistantDialog'
import { GlobalSearch } from '../components/layout/GlobalSearch'
import { WorkspaceTransition } from '../components/layout/WorkspaceTransition'
import { useWorkbenchCodex } from '../stores/workbench-codex'

const LiteratureWorkspace = lazy(() =>
  import('../components/literature/LiteratureWorkspace').then((m) => ({
    default: m.LiteratureWorkspace
  }))
)
const OutputsWorkspace = lazy(() =>
  import('../components/outputs/OutputsWorkspace').then((m) => ({ default: m.OutputsWorkspace }))
)
const SettingsWorkspace = lazy(() =>
  import('../components/settings/SettingsWorkspace').then((m) => ({ default: m.SettingsWorkspace }))
)
const SubmissionsWorkspace = lazy(() =>
  import('../components/submissions/SubmissionsWorkspace').then((m) => ({
    default: m.SubmissionsWorkspace
  }))
)
const ReportsWorkspace = lazy(() => import('../components/reports/ReportsWorkspace').then(m => ({ default: m.ReportsWorkspace })))
const CodexWorkspace = lazy(() => import('../components/codex/CodexWorkspace').then(m => ({ default: m.CodexWorkspace })))

async function flushWorkspace() {
  if (useAssistant.getState().busy) {
    useWorkbench.getState().notify('AI 正在处理计划，请等结果返回后再关闭。', 'info')
    return false
  }
  return await useWorkbench.getState().flushAll() && await useInterface.getState().flush()
}
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Workspace rendering error', error, info.componentStack)
  }
  render() {
    return this.state.failed ? (
      <div className="startup-state">
        <AlertCircle size={26} />
        <h1>工作区暂时无法显示。</h1>
        <p>已保存的数据未受影响。可以重新打开工作区，或正常关闭应用。</p>
        <Button variant="primary" onClick={async () => { if (await flushWorkspace()) this.setState({ failed: false }) }}>重新打开工作区</Button>
      </div>
    ) : (
      this.props.children
    )
  }
}
function Workbench() {
  const bootstrap = useWorkbench((s) => s.bootstrap)
  const ready = useWorkbench((s) => s.ready)
  const loading = useWorkbench((s) => s.loading)
  const startupError = useWorkbench((s) => s.startupError)
  const section = useWorkbench((s) => s.section)
  const view = useWorkbench((s) => s.view)
  const projectId = useWorkbench((s) => s.projectId)
  const selectedTaskId = useWorkbench((s) => s.selectedTaskId)
  const tasks = useTasks()
  const reducedMotion = useReducedMotion()
  const libraryLoaded = useLibrary(s => s.loaded || Boolean(s.loadError))
  useEffect(() => {
    if ((ready && (!new URLSearchParams(location.search).has('paper') || libraryLoaded)) || startupError) window.workbench.workbenchReady()
  }, [ready, libraryLoaded, startupError])
  useAppearance()
  useEffect(() => {
    const open = async (paper: { id: string; variant: 'source' | 'translated' }) => {
      useWorkbench.getState().setSection('literature')
      useLibrary.getState().openPaper(paper.id, paper.variant, undefined, undefined, true)
      await useLibrary.getState().load()
    }
    const off = window.workbench.onOpenDesktopPaper(paper => { void open(paper) })
    return off
  }, [])
  useEffect(() => {
    if (new URLSearchParams(location.search).get('section') === 'submissions') useWorkbench.getState().setSection('submissions')
  }, [])
  useEffect(() => window.workbench.onTasksChanged(() => {
    void window.workbench.desktopTasks().then(result => {
      if (result.ok) useWorkbench.setState({ tasks: result.data.tasks, projects: result.data.projects })
    })
  }), [])
  useEffect(() => {
    void bootstrap()
    void useAssistant.getState().load()
  }, [bootstrap])
  useEffect(() => {
    if (!ready) return
    const off = window.workbench.onLibraryChanged(() => {
      void useLibrary.getState().load()
    })
    const offProgress = window.workbench.onTranslationProgress((progress, active) =>
      useLibrary.getState().setTranslationProgress(progress, active)
    )
    void useLibrary.getState().load()
    return () => {
      off()
      offProgress()
    }
  }, [ready])
  useEffect(() => {
    if (!ready) return
    const off = window.workbench.onSubmissionsChanged(() => {
      void useSubmissions.getState().load()
    })
    const open = window.workbench.onOpenSubmissions(() =>
      useWorkbench.getState().setSection('submissions')
    )
    void useSubmissions.getState().load()
    return () => {
      off()
      open()
    }
  }, [ready])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing) return
      const state = useWorkbench.getState()
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'n' &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault()
        state.focusCapture()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('workbench:command-palette-request'))
      }
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]'))
        state.selectTask(null)
    }
    const modality = (event: KeyboardEvent | PointerEvent) => {
      document.documentElement.dataset.input = event.type === 'keydown' ? 'keyboard' : 'pointer'
    }
    window.addEventListener('keydown', keyboard)
    window.addEventListener('keydown', modality)
    window.addEventListener('pointerdown', modality)
    return () => {
      window.removeEventListener('keydown', keyboard)
      window.removeEventListener('keydown', modality)
      window.removeEventListener('pointerdown', modality)
    }
  }, [])
  const task = tasks.find((t) => t.id === selectedTaskId)
  const workspaceKey = section === 'planner' ? `${section}-${view}-${projectId ?? 'all'}` : section
  const workspace = section === 'planner' ? (
    <PlannerWorkspace />
  ) : section === 'literature' ? (
    <Suspense fallback={<WorkspaceLoading />}>
      <LiteratureWorkspace />
    </Suspense>
  ) : section === 'outputs' ? (
    <Suspense fallback={<WorkspaceLoading />}>
      <OutputsWorkspace />
    </Suspense>
  ) : section === 'submissions' ? (
    <Suspense fallback={<WorkspaceLoading />}>
      <SubmissionsWorkspace />
    </Suspense>
  ) : section === 'reports' ? (
    <Suspense fallback={<WorkspaceLoading />}><ReportsWorkspace /></Suspense>
  ) : section === 'codex' ? (
    <Suspense fallback={<WorkspaceLoading />}><CodexWorkspace /></Suspense>
  ) : (
    <Suspense fallback={<WorkspaceLoading />}>
      <SettingsWorkspace />
    </Suspense>
  )
  return (
    <div className="app-shell">
      <WorkspaceBackground />
      <Titlebar />
      {!ready ? (
        <div className="startup-state">
          {loading ? (
            <>
              <span className="workspace-spinner" role="status" aria-label="加载工作台" />
            </>
          ) : (
            <>
              <AlertCircle size={28} />
              <h1>无法打开本地工作区</h1>
              <p>{startupError}</p>
              <Button onClick={() => void bootstrap()}>重试</Button>
            </>
          )}
        </div>
      ) : (
        <>
          <Sidebar />
          <MetadataQueue />
          <div className="main-region">
            <div className="workspace-frame">
              <AnimatePresence initial={false} mode="popLayout">
                <WorkspaceTransition key={workspaceKey} reduced={!!reducedMotion}>
                  {workspace}
                </WorkspaceTransition>
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {section === 'planner' && task && <TaskInspector key="task-inspector" task={task} />}
              </AnimatePresence>
            </div>
            <Dock />
          </div>
          <AssistantDialog />
          <GlobalSearch />
        </>
      )}
      <Toasts />
    </div>
  )
}
export function App() {
  useEffect(() => window.workbench.onWorkbenchCodexEvent(useWorkbenchCodex.getState().receive), [])
  // Keep the close handshake mounted even when a workspace fails to render.
  useEffect(() => window.workbench.onBeforeClose(flushWorkspace), [])
  useEffect(() => window.workbench.onWorkbenchShown(() => {
    useLibrary.setState({ returningToDesktop: false })
    const shell = document.querySelector('.app-shell')
    if (!shell) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const animation of shell.getAnimations()) animation.cancel()
    shell.animate(reduced ? [{ opacity: .7 }, { opacity: 1 }] : [{ opacity: .65, transform: 'translateX(12px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: reduced ? 100 : 360, easing: 'cubic-bezier(.22,1,.36,1)' })
  }), [])
  return (
    <ErrorBoundary>
      <Workbench />
    </ErrorBoundary>
  )
}
function WorkspaceLoading() { return <div className="startup-state" role="status" aria-label="加载工作区"><span className="workspace-spinner"/></div> }
