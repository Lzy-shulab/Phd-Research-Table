import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { FolderPlus, Sparkles, Plus } from 'lucide-react'
import { useAssistant, assistantConfigured } from '../../stores/assistant'
import { useWorkbench } from '../../stores/workbench'
import type { TaskCreate } from '../../../shared/types'
import { ProjectSelect } from '../projects/ProjectSelect'
import { ProjectDialog } from '../projects/ProjectDialog'
export interface QuickCaptureHandle {
  focusProject: (projectId: string | null) => void
}
export function QuickCapture({
  defaults,
  context,
  ref
}: {
  defaults: Omit<TaskCreate, 'title'>
  context: string
  ref?: Ref<QuickCaptureHandle>
}) {
  const [title, setTitle] = useState('')
  const settings = useAssistant((state) => state.settings)
  const assistantBusy = useAssistant((state) => state.busy)
  const recognitionSaving = useAssistant((state) => state.recognitionSaving)
  const configured = assistantConfigured(settings)
  const recognitionEnabled = settings?.quickRecognitionEnabled ?? true
  const input = useRef<HTMLInputElement>(null)
  const request = useWorkbench((s) => s.captureRequest)
  const projects = useWorkbench((s) => s.projects).filter((p) => !p.archivedAt)
  const [chosenProject, setChosenProject] = useState('')
  const [newProject, setNewProject] = useState(false)
  const projectId = projects.some((p) => p.id === chosenProject)
    ? chosenProject
    : projects.some((p) => p.id === defaults.projectId)
      ? defaults.projectId!
      : projects.length === 1
        ? projects[0]!.id
        : ''
  useImperativeHandle(
    ref,
    () => ({
      focusProject: (id) => {
        setChosenProject(id ?? '')
        input.current?.focus()
        input.current?.scrollIntoView({ block: 'nearest' })
      }
    }),
    []
  )
  useEffect(() => {
    if (request > 0) input.current?.focus()
  }, [request])
  return (
    <>
      <form
        className="quick-capture"
        onSubmit={async (e) => {
          e.preventDefault()
          const cleanTitle = title.trim()
          if (!cleanTitle || assistantBusy || recognitionSaving) return
          if (recognitionEnabled) {
            if (!configured) {
              useAssistant.getState().show(cleanTitle, projectId || null)
              return
            }
            useAssistant.setState({ context: '' })
            if (await useAssistant.getState().send(cleanTitle, projectId || null)) setTitle('')
            return
          }
          const created = await useWorkbench
            .getState()
            .createTask({ ...defaults, title: cleanTitle, projectId: projectId || null })
          if (created) setTitle('')
        }}
      >
        <Plus size={18} />
        <input
          ref={input}
          aria-label="添加一个研究任务"
          placeholder={recognitionEnabled ? '描述安排，自动识别日期、时间和项目…' : '输入任务标题…'}
          value={title}
          maxLength={500}
          onChange={(e) => setTitle(e.target.value)}
          disabled={assistantBusy}
        />
        <span className="capture-context">{context}</span>
        <ProjectSelect
          value={projectId}
          onChange={setChosenProject}
          allowAutomatic={recognitionEnabled}
        />
        <button type="button" className="capture-new-project" onClick={() => setNewProject(true)}>
          <FolderPlus size={14} />
          新建项目
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={recognitionEnabled}
          className="capture-ai-toggle"
          title={recognitionEnabled ? 'AI 识别已开启，点击关闭' : 'AI 识别已关闭，点击开启'}
          aria-label="AI 识别"
          disabled={assistantBusy || recognitionSaving}
          onClick={() => void useAssistant.getState().setQuickRecognition(!recognitionEnabled)}
        >
          <Sparkles size={15} />
          <span>AI 识别</span>
          <span className="capture-ai-switch" aria-hidden="true">
            <i />
          </span>
        </button>
        <button
          type="submit"
          className="capture-submit capture-add"
          title={
            recognitionEnabled
              ? '识别日期、时间和项目后添加（Enter）'
              : '不经过 AI，按当前选择直接添加（Enter）'
          }
          aria-label={recognitionEnabled ? 'AI 识别并添加任务' : '直接添加任务'}
          disabled={assistantBusy || recognitionSaving || !title.trim()}
        >
          {assistantBusy ? <span className="tiny-spinner" /> : <Plus size={15} />}
          <span>{assistantBusy ? '识别中…' : '添加'}</span>
        </button>
      </form>
      {newProject && (
        <ProjectDialog
          onClose={() => setNewProject(false)}
          onCreated={(project) => setChosenProject(project.id)}
        />
      )}
    </>
  )
}
