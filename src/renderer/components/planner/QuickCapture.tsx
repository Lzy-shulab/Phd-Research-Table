import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { CalendarClock, ChevronDown, Sparkles, Plus } from 'lucide-react'
import { useAssistant, assistantConfigured } from '../../stores/assistant'
import { useWorkbench } from '../../stores/workbench'
import type { TaskCreate, TaskTemplate } from '../../../shared/types'
import { ProjectSelect } from '../projects/ProjectSelect'
import { ProjectDialog } from '../projects/ProjectDialog'
import { DateInput } from '../ui/date-input'
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
  const [title, setTitle] = useState(() => localStorage.getItem('workbench.quick-capture') ?? '')
  const [scheduledDate, setScheduledDate] = useState(defaults.scheduledDate ?? '')
  const settings = useAssistant((state) => state.settings)
  const assistantBusy = useAssistant((state) => state.busy)
  const recognitionSaving = useAssistant((state) => state.recognitionSaving)
  const configured = assistantConfigured(settings)
  const recognitionEnabled = settings?.quickRecognitionEnabled ?? false
  const input = useRef<HTMLInputElement>(null)
  const request = useWorkbench((s) => s.captureRequest)
  const projects = useWorkbench((s) => s.projects).filter((p) => !p.archivedAt)
  const [chosenProject, setChosenProject] = useState('')
  const [newProject, setNewProject] = useState(false)
  const [createAfterProject, setCreateAfterProject] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [occurrences, setOccurrences] = useState(8)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [chosenTemplate, setChosenTemplate] = useState<TaskTemplate | null>(null)
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
  useEffect(() => { void window.workbench.taskTemplates().then((result) => { if (result.ok) setTemplates(result.data) }) }, [])
  useEffect(() => {
    if (title) localStorage.setItem('workbench.quick-capture', title)
    else localStorage.removeItem('workbench.quick-capture')
  }, [title])
  const submit = async (selectedProjectId = projectId) => {
    const cleanTitle = title.trim()
    if (!cleanTitle || assistantBusy || recognitionSaving) return
    if (!selectedProjectId && !recognitionEnabled) {
      setCreateAfterProject(true)
      setNewProject(true)
      return
    }
    if (recognitionEnabled) {
      if (!configured) {
        useAssistant.getState().show(cleanTitle, selectedProjectId || null)
        return
      }
      useAssistant.setState({ context: '' })
      if (await useAssistant.getState().send(cleanTitle, selectedProjectId || null)) setTitle('')
      return
    }
    const templateFields = chosenTemplate ? { description: chosenTemplate.description, priority: chosenTemplate.priority, estimatedMinutes: chosenTemplate.estimatedMinutes, checklist: chosenTemplate.checklist.map((item) => ({ ...item, id: crypto.randomUUID(), completed: false })), sourceType: 'template' as const, sourceId: chosenTemplate.id } : {}
    if (repeat && scheduledDate) {
      const created = await useWorkbench.getState().createTaskSeries({ ...defaults, ...templateFields, title: cleanTitle, projectId: selectedProjectId, scheduledDate, recurrence: 'weekly', occurrences })
      if (created.length) setTitle('')
    } else {
      const created = await useWorkbench.getState().createTask({ ...defaults, ...templateFields, title: cleanTitle, projectId: selectedProjectId, scheduledDate: scheduledDate || null })
      if (created) setTitle('')
    }
  }
  return (
    <>
      <form
        className="quick-capture"
        onSubmit={async (e) => {
          e.preventDefault()
          await submit()
        }}
      >
        <Plus size={18} />
        <input
          ref={input}
          aria-label="添加一个研究任务"
          placeholder={recognitionEnabled ? '描述安排，自动识别日期、时间和项目…' : '输入任务标题，回车添加…'}
          value={title}
          maxLength={500}
          onChange={(e) => setTitle(e.target.value)}
          disabled={assistantBusy}
        />
        <ProjectSelect
          value={projectId}
          onChange={setChosenProject}
          onCreate={() => { setCreateAfterProject(false); setNewProject(true) }}
          allowAutomatic={recognitionEnabled}
        />
        {!recognitionEnabled && <div className="capture-date" title={`安排日期：${scheduledDate || context}`}><DateInput label="新任务安排日期" value={scheduledDate} onChange={setScheduledDate} /></div>}
        <details className="capture-more">
          <summary aria-label="更多任务选项">更多选项{recognitionEnabled && <Sparkles size={13} aria-label="智能识别已开启" />}<ChevronDown size={14} /></summary>
          <div className="capture-more-controls">
            <p>直接添加只需标题和项目；以下设置按需使用。</p>
            {templates.length > 0 && <select className="capture-template" aria-label="使用任务模板" value={chosenTemplate?.id ?? ''} onChange={(event) => { const template = templates.find((item) => item.id === event.target.value) ?? null; setChosenTemplate(template); if (!template) return; setTitle(template.title); if (template.projectId) setChosenProject(template.projectId) }}><option value="">任务模板…</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>}
            {scheduledDate && <label className="capture-repeat" title="每周生成彼此独立的安排"><input type="checkbox" checked={repeat} onChange={(event) => { setRepeat(event.target.checked); if (event.target.checked && recognitionEnabled) void useAssistant.getState().setQuickRecognition(false) }} /><CalendarClock size={14} /><span>每周重复</span>{repeat && <input aria-label="重复次数" type="number" min={2} max={52} value={occurrences} onChange={(event) => setOccurrences(Math.max(2, Math.min(52, Number(event.target.value) || 2)))} />}</label>}
            <button type="button" role="switch" aria-checked={recognitionEnabled} className="capture-ai-toggle" title="开启后用 AI 识别日期、时间和项目，再添加任务" aria-label="AI 识别日期时间和项目" disabled={assistantBusy || recognitionSaving} onClick={() => void useAssistant.getState().setQuickRecognition(!recognitionEnabled)}><Sparkles size={15} /><span>AI 识别日期、时间和项目</span><span className="capture-ai-switch" aria-hidden="true"><i /></span></button>
          </div>
        </details>
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
          onClose={() => { setNewProject(false); setCreateAfterProject(false) }}
          onCreated={(project) => {
            setChosenProject(project.id)
            if (createAfterProject) void submit(project.id)
          }}
        />
      )}
    </>
  )
}
