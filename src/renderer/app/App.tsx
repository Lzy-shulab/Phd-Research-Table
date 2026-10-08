import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AlertCircle, Orbit } from 'lucide-react'
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
  useAppearance()
  useEffect(() => {
    void bootstrap()
    void useAssistant.getState().load()
  }, [bootstrap])
  useEffect(() => {
    if (!ready) return
    const off = window.workbench.onLibraryChanged(() => {
      void useLibrary.getState().load()
    })
    const offProgress = window.workbench.onTranslationProgress((progress) =>
      useLibrary.getState().setTranslationProgress(progress)
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
    <Suspense fallback={<div className="startup-state">正在打开文献库…</div>}>
      <LiteratureWorkspace />
    </Suspense>
  ) : section === 'outputs' ? (
    <Suspense fallback={<div className="startup-state">正在打开科研成果…</div>}>
      <OutputsWorkspace />
    </Suspense>
  ) : section === 'submissions' ? (
    <Suspense fallback={<div className="startup-state">正在打开投稿记录…</div>}>
      <SubmissionsWorkspace />
    </Suspense>
  ) : section === 'reports' ? (
    <Suspense fallback={<div className="startup-state">正在打开研究报表…</div>}><ReportsWorkspace /></Suspense>
  ) : (
    <Suspense fallback={<div className="startup-state">正在打开设置…</div>}>
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
              <Orbit size={28} strokeWidth={1.5} />
              <p>正在打开科研工作台…</p>
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
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                className="workspace-stage"
                key={workspaceKey}
                initial={{ opacity: 0, y: reducedMotion ? 0 : 7 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
                transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                {workspace}
              </motion.div>
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {section === 'planner' && task && <TaskInspector key="task-inspector" task={task} />}
            </AnimatePresence>
          </div>
          <Dock />
          <AssistantDialog />
          <GlobalSearch />
        </>
      )}
      <Toasts />
    </div>
  )
}
export function App() {
  // Keep the close handshake mounted even when a workspace fails to render.
  useEffect(() => window.workbench.onBeforeClose(flushWorkspace), [])
  return (
    <ErrorBoundary>
      <Workbench />
    </ErrorBoundary>
  )
}
