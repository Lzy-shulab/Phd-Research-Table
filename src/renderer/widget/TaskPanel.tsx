import { useCallback, useEffect, useState } from 'react'
import { ArrowUp, BellSimpleRinging, CaretDown as ChevronDown, CaretRight as ChevronRight, Folder, PencilSimple, Plus, CheckCircle, Sparkle } from '@phosphor-icons/react'
import type { DesktopTaskDraft, Project, Task, TaskCreate } from '../../shared/types'
import type { DesktopNotice } from '../../shared/widget'
import { localDay } from '../../shared/arxiv'
import { desktopProjectCandidates, desktopTaskMatches, hasClearDesktopSchedule, parseQuickDesktopTask, readTaskReminder, taskReminderLabel, taskReminderMinutes, type DesktopTaskPeriod } from '../../domain/desktop-tasks'
import { PanelFrame } from './PanelFrame'
import { PanelFooter } from './PanelFooter'
import { DesktopTabs } from './DesktopTabs'
import { DesktopDisclosure } from './DesktopDisclosure'
import { TaskEditor } from './TaskEditor'
import { unwrap } from './api'

const periods: [DesktopTaskPeriod, string][] = [['today', '今天'], ['week', '本周'], ['month', '本月'], ['inbox', '待安排']]
export function TaskPanel() {
  const [tasks, setTasks] = useState<Task[]>([]), [projects, setProjects] = useState<Project[]>([])
  const [period, setPeriod] = useState<DesktopTaskPeriod>('today')
  const [title, setTitle] = useState(() => sessionStorage.getItem('desktop-task-draft') ?? '')
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<DesktopTaskDraft | null>(null), [recognizing, setRecognizing] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [notices, setNotices] = useState<DesktopNotice[]>([])
  const [acknowledging, setAcknowledging] = useState(false)
  const [scheduled, setScheduled] = useState('')
  const [feedback, setFeedback] = useState<{ id: string; action: 'completed' | 'saved' } | null>(null)
  const [showDone, setShowDone] = useState(true)
  const [projectId, setProjectId] = useState(() => sessionStorage.getItem('desktop-task-project') ?? 'all')
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const activeProjects = projects.filter(p => !p.archivedAt)
  const selectedProject = ['all', 'unassigned'].includes(projectId) || projects.some(project => project.id === projectId) ? projectId : 'all'
  const captureProject = activeProjects.find(project => project.id === selectedProject)
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : '更新失败，请重试。')
  const reload = useCallback(async () => {
    const data = unwrap(await window.workbench.desktopTasks()); setTasks(data.tasks); setProjects(data.projects); setUpdatedAt(Date.now()); setLoading(false)
  }, [])
  useEffect(() => {
    void reload().catch(e => { fail(e); setLoading(false) })
    return window.workbench.onTasksChanged(() => { void reload().catch(fail) })
  }, [reload])
  useEffect(() => {
    const readNotices = (snapshot: { notices: DesktopNotice[] }) => setNotices(snapshot.notices.filter(item => item.kind === 'task'))
    const unsubscribe = window.workbench.onWidgetChanged(readNotices)
    void window.workbench.widgetSnapshot().then(result => { if (result.ok) readNotices(result.data) })
    return unsubscribe
  }, [])
  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(null), 520)
    return () => clearTimeout(timer)
  }, [feedback])
  const mutate = async (work: () => Promise<unknown>) => { setSaving(true); setError(''); try { await work(); await reload() } catch (e) { fail(e) } finally { setSaving(false) } }
  const clearTitle = () => { setTitle(''); sessionStorage.removeItem('desktop-task-draft') }
  const recognize = async () => {
    setRecognizing(true); setError(''); setScheduled('')
    try {
      setDraft(unwrap(await window.workbench.recognizeDesktopTask(title.trim(), captureProject?.id)))
    } catch {
      const local = parseQuickDesktopTask(title)
      setDraft({ ...local, projectId: desktopProjectCandidates(local.title, projects, tasks).projectId ?? captureProject?.id ?? null })
      setError('Codex 暂未返回结果，请补齐日程。')
    }
    finally { setRecognizing(false) }
  }
  const schedule = (input: TaskCreate) => {
    if (!input.projectId || !input.scheduledDate || !input.startTime || saving) { setError('请选择项目、日期和开始时间。'); return }
    void mutate(async () => {
      const task = unwrap(await window.workbench.createTask(input))
      clearTitle(); setDraft(null); setError('')
      setScheduled(`已加入 ${task.scheduledDate?.slice(5)} ${task.startTime} 日程`)
      setPeriod(desktopTaskMatches(task, 'today') ? 'today' : desktopTaskMatches(task, 'week') ? 'week' : 'month')
      setProjectId(input.projectId!)
      sessionStorage.setItem('desktop-task-project', input.projectId!)
    })
  }
  const closeEditor = () => { if (!saving) { setDraft(null); setEditing(null); setError('') } }
  const notice = notices[0]
  const confirmNotice = async () => {
    if (!notice || acknowledging) return
    setAcknowledging(true)
    try {
      const snapshot = unwrap(await window.workbench.acknowledgeDesktopNotice(notice.id))
      setNotices(snapshot.notices.filter(item => item.kind === 'task'))
      setScheduled('已确认收到提醒')
    } catch (error) { fail(error) }
    finally { setAcknowledging(false) }
  }
  const rows = tasks.filter(t => desktopTaskMatches(t, period) && (selectedProject === 'all' || (selectedProject === 'unassigned' ? !t.projectId : t.projectId === selectedProject)))
  const pending = rows.filter(t => t.status !== 'completed'), done = rows.filter(t => t.status === 'completed')
  const row = (task: Task) => <li className={`desktop-task ${task.status === 'completed' ? 'is-done' : ''}`} data-confirmed={feedback?.id === task.id && feedback.action === 'completed'} data-saved={feedback?.id === task.id && feedback.action === 'saved'} key={task.id}>
    <input type="checkbox" aria-label={`完成 ${task.title}`} checked={task.status === 'completed'} disabled={saving} onChange={() => {
      void mutate(async () => {
        const updated = unwrap(await window.workbench.completeTask(task.id, task.status !== 'completed'))
        setFeedback(updated.status === 'completed' ? { id: updated.id, action: 'completed' } : null)
      })
    }} />
    <div><div className="desktop-task-title"><i data-priority={task.priority} />{task.status === 'completed' ? <span>{readTaskReminder(task.title).title}</span> :
      <button type="button" title="编辑任务" aria-label={`编辑 ${readTaskReminder(task.title).title}`} disabled={saving}
        onClick={() => { setEditing(task); setError(''); setScheduled('') }}>
        <span>{readTaskReminder(task.title).title}</span><PencilSimple size={17} aria-hidden="true"/>
      </button>}</div>
      {((selectedProject === 'all' && task.projectId) || task.dueDate || task.startTime) && <div className="desktop-task-meta">{selectedProject === 'all' && task.projectId && <span>{projects.find(p => p.id === task.projectId)?.name}</span>}{task.startTime && <span>{task.startTime}{task.endTime ? `–${task.endTime}` : ''}</span>}{task.startTime && task.status !== 'completed' && <span className="desktop-task-lead"><BellSimpleRinging size={14}/>{taskReminderLabel(taskReminderMinutes(task))}</span>}{task.dueDate && <time>{task.dueDate} 截止</time>}</div>}
      {task.checklist.length > 0 && <ul className="desktop-checklist">{task.checklist.map(item => <li key={item.id}><label><input type="checkbox" checked={item.completed} disabled={saving} onChange={() => { void mutate(async () => unwrap(await window.workbench.updateTask(task.id, { checklist: task.checklist.map(c => c.id === item.id ? { ...c, completed: !c.completed } : c) }))) }} />{item.text}</label></li>)}</ul>}
    </div><time className="desktop-task-date">{task.scheduledDate === localDay() ? '今天' : task.scheduledDate?.slice(5).replace('-', '.') ?? ''}</time>
  </li>
  return <><PanelFrame title="任务总览" covered={Boolean(draft || editing)} busy={Boolean(draft || editing) || saving || recognizing} footer={<PanelFooter status={recognizing ? '正在识别任务…' : saving ? '保存中' : error ? '请重试' : scheduled || undefined} updatedAt={updatedAt} busy={loading || saving} refreshLabel="刷新任务" onRefresh={() => { setLoading(true); void reload().then(() => setError('')).catch(e => { fail(e); setLoading(false) }) }}/> }>
    <DesktopTabs label="任务范围" selected={period}>{periods.map(([key, label]) => <button key={key} role="tab" aria-selected={period === key} onClick={() => setPeriod(key)}>{label}</button>)}</DesktopTabs>
    <div className="desktop-project"><Folder size={20}/><select aria-label="任务所属项目" id="desktop-project" value={selectedProject} onChange={e => { setProjectId(e.target.value); sessionStorage.setItem('desktop-task-project', e.target.value) }}><option value="all">全部项目</option><option value="unassigned">未归属项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.archivedAt ? '（已归档）' : ''}</option>)}</select>{!activeProjects.length && <button title="在工作台创建项目" aria-label="在工作台创建项目" onClick={() => { void window.workbench.openWorkbench() }}><Plus size={20}/></button>}</div>
    <form className="desktop-capture" onSubmit={e => {
      e.preventDefault()
      if (!title.trim() || saving || recognizing || !captureProject) return
      void mutate(async () => {
        const parsed = parseQuickDesktopTask(title)
        const input = hasClearDesktopSchedule(parsed, title) ? parsed : { title: readTaskReminder(title).title,
          scheduledDate: period === 'inbox' ? null : localDay(), reminderMinutes: parsed.reminderMinutes }
        const task = unwrap(await window.workbench.createTask({ ...input, projectId: captureProject.id }))
        clearTitle()
        if (task.startTime) setScheduled(`已加入 ${task.scheduledDate?.slice(5)} ${task.startTime} 日程`)
      })
    }}>
      <input aria-label="新任务" placeholder="例如 明天下午 3 点跑消融实验" maxLength={500} value={title} disabled={recognizing} onChange={e => { setTitle(e.target.value); sessionStorage.setItem('desktop-task-draft', e.target.value) }} />
      <button className="desktop-capture-ai" type="button" aria-label="AI 识别任务" title="用 Codex 识别任务" disabled={saving || recognizing || !title.trim() || !activeProjects.length} onClick={() => { void recognize() }}>{recognizing ? <span className="desktop-spinner"/> : <Sparkle size={22}/>}<span>AI</span></button>
      <button type="submit" aria-label="创建任务" disabled={saving || recognizing || !title.trim() || !captureProject}><ArrowUp size={18} /></button>
    </form>
    {notice && <section key={notice.id} className="desktop-task-notice" aria-label="任务提醒">
      <BellSimpleRinging size={20} weight="duotone" aria-hidden="true"/>
      <div role="status"><strong>{notice.title}{notices.length > 1 && <small> · {notices.length} 项</small>}</strong><span title={notice.detail}>{notice.detail}</span></div>
      <button type="button" disabled={acknowledging} onClick={() => { void confirmNotice() }}>确认收到</button>
    </section>}
    {error && <button className="desktop-error" role="alert" onClick={() => { void reload().then(() => setError('')).catch(fail) }}>{error}</button>}
    <div key={period} className="desktop-list" aria-live="polite">{loading ? <p className="desktop-empty">正在读取任务…</p> : <>
      <h2 className="desktop-group"><ChevronDown size={14} />未完成 <span>{pending.length}</span></h2><ul>{pending.map(row)}</ul>
      {!pending.length && <div className="desktop-quiet-empty"><CheckCircle size={40} weight="duotone"/><span>{done.length ? '已完成' : '暂无任务'}</span></div>}
      {done.length > 0 && <><button className="desktop-group" aria-expanded={showDone} aria-controls="desktop-done-tasks" onClick={() => setShowDone(!showDone)}>{showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />}已完成 <span>{done.length}</span></button><DesktopDisclosure id="desktop-done-tasks" open={showDone}>{() => <ul>{done.map(row)}</ul>}</DesktopDisclosure></>}
    </>}</div>
  </PanelFrame>
  {draft && <TaskEditor draft={draft} projects={projects} saving={saving} error={error} close={closeEditor} save={schedule}/>}
  {editing && <TaskEditor task={editing} projects={projects} saving={saving} error={error} close={closeEditor} save={patch => {
    if (!Object.keys(patch).length) { closeEditor(); return }
    void mutate(async () => {
      unwrap(await window.workbench.updateTask(editing.id, patch))
      setFeedback({ id: editing.id, action: 'saved' }); setEditing(null); setScheduled('已保存任务')
    })
  }}/>}</>
}
