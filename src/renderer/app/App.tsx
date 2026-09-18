import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
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
        <p>已保存的数据未受影响，请重新启动应用。</p>
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
    const off = window.workbench?.onBeforeClose(async () => {
      if (useAssistant.getState().busy) {
        useWorkbench.getState().notify('AI 正在处理计划，请等结果返回后再关闭。', 'info')
        return false
      }
      if (!(await useWorkbench.getState().flushAll())) return false
      if (!(await useInterface.getState().flush())) {
        useWorkbench.getState().notify('背景正在保存，完成后再关闭。', 'info')
        return false
      }
      return true
    })
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
        state.notify('命令面板尚未开放。按 Ctrl+N 可添加任务。', 'info')
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
      off?.()
      window.removeEventListener('keydown', keyboard)
      window.removeEventListener('keydown', modality)
      window.removeEventListener('pointerdown', modality)
    }
  }, [])
  const task = tasks.find((t) => t.id === selectedTaskId)
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
            {section === 'planner' ? (
              <>
                <PlannerWorkspace key={`${view}-${projectId}`} />
                <AnimatePresence initial={false}>
                  {task && <TaskInspector key="task-inspector" task={task} />}
                </AnimatePresence>
              </>
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
            ) : (
              <Suspense fallback={<div className="startup-state">正在打开设置…</div>}>
                <SettingsWorkspace />
              </Suspense>
            )}
          </div>
          <Dock />
          <AssistantDialog />
        </>
      )}
      <Toasts />
    </div>
  )
}
export function App() {
  return (
    <ErrorBoundary>
      <Workbench />
    </ErrorBoundary>
  )
}
