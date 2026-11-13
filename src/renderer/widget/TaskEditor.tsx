import { useState } from 'react'
import { CaretDown, Plus, X } from '@phosphor-icons/react'
import { priorities, type DesktopTaskDraft, type Project, type Task, type TaskCreate, type TaskPatch } from '../../shared/types'
import { priorityLabels } from '../../shared/labels'
import { readTaskReminder, taskReminderMinutes } from '../../domain/desktop-tasks'
import { DesktopDisclosure } from './DesktopDisclosure'
import { WidgetDateField, WidgetTimeField } from './fields'
import { WidgetSheet } from './panels'

const editableFields = (task: Task) => {
  const { title, projectId, scheduledDate, startTime, endTime, reminderMinutes, dueDate, description,
    priority, estimatedMinutes, deferredUntil, milestone, checklist } = task
  return { title, projectId, scheduledDate, startTime, endTime, reminderMinutes, dueDate, description,
    priority, estimatedMinutes, deferredUntil, milestone, checklist }
}

type Props = { projects: Project[]; saving: boolean; error: string; close: () => void } & (
  { task: Task; draft?: never; save: (patch: TaskPatch) => void } |
  { task?: never; draft: DesktopTaskDraft; save: (input: TaskCreate) => void }
)

export function TaskEditor(props: Props) {
  const { task, projects, saving, error, close } = props
  const [fields, setFields] = useState(() => task ? { ...editableFields(task), reminderMinutes: task.reminderMinutes ?? readTaskReminder(task.title).minutes } : {
    ...props.draft!, dueDate: null, description: '', priority: 'none' as Task['priority'],
    estimatedMinutes: null, deferredUntil: null, milestone: '', checklist: [] as Task['checklist']
  })
  const [more, setMore] = useState(false)
  const [checklistText, setChecklistText] = useState('')
  const set = (patch: Partial<typeof fields>) => setFields(current => ({ ...current, ...patch }))
  const addChecklistItem = () => {
    const text = checklistText.trim()
    if (!text || fields.checklist.length >= 100) return
    set({ checklist: [...fields.checklist, { id: crypto.randomUUID(), text, completed: false }] })
    setChecklistText('')
  }

  return <WidgetSheet page="task-capture" title={task ? '编辑任务' : '确认任务日程'} backLabel="返回任务总览" close={close} back={close}>
    <form className="widget-form widget-task-review" onSubmit={event => {
      event.preventDefault()
      if (saving) return
      if (props.task) {
        const previous = editableFields(props.task)
        const patch: TaskPatch = Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== previous[key as keyof typeof previous]))
        props.save(patch)
      } else {
        const { title, projectId, scheduledDate, startTime, endTime, reminderMinutes } = fields
        props.save({ title, projectId, scheduledDate, startTime, endTime, reminderMinutes })
      }
    }}>
      <label>任务<input required maxLength={500} value={fields.title} disabled={saving} onChange={event => set({ title: event.target.value })}/></label>
      <label>所属项目<select aria-label="所属项目" required={!task || Boolean(task.projectId)} value={fields.projectId ?? ''} disabled={saving}
        onChange={event => set({ projectId: event.target.value || null })}>
        <option value="" disabled={Boolean(task?.projectId)}>{task ? '未归属项目' : '选择项目'}</option>
        {projects.filter(project => !project.archivedAt || project.id === task?.projectId).map(project =>
          <option key={project.id} value={project.id}>{project.name}{project.archivedAt ? '（已归档）' : ''}</option>)}
      </select></label>
      <label>日期<WidgetDateField required={!task} value={fields.scheduledDate ?? ''} disabled={saving}
        onChange={event => { const date = event.target.value || null; set(date ? { scheduledDate: date } : { scheduledDate: null, startTime: null, endTime: null }) }}/></label>
      <div className="widget-form-pair">
        <label>开始时间<WidgetTimeField required={!task} value={fields.startTime ?? ''} disabled={saving || !fields.scheduledDate}
          onChange={event => { const time = event.target.value || null; set(time ? { startTime: time } : { startTime: null, endTime: null }) }}/></label>
        <label>结束时间<WidgetTimeField value={fields.endTime ?? ''} disabled={saving || !fields.startTime}
          onChange={event => set({ endTime: event.target.value || null })}/></label>
      </div>
      <label>提前提醒（分钟）<input type="number" aria-label="提前提醒（分钟）" aria-describedby="task-reminder-help" min={0} max={43_200} step={1} value={fields.reminderMinutes ?? ''}
        placeholder={String(taskReminderMinutes(fields))} disabled={saving || !fields.startTime}
        onChange={event => set({ reminderMinutes: event.target.value === '' ? null : event.target.valueAsNumber })}/>
        <small id="task-reminder-help" className="widget-form-note">0 表示准时提醒，留空使用 {taskReminderMinutes({ title: fields.title, reminderMinutes: null })} 分钟。</small>
      </label>
      {task && <>
        <button type="button" className="widget-task-more" aria-controls="widget-task-details" aria-expanded={more} onClick={() => setMore(!more)}>
          更多任务信息 <CaretDown size={16}/>
        </button>
        <DesktopDisclosure id="widget-task-details" open={more}>{() => <div className="widget-form widget-task-details">
          <div className="widget-form-pair">
            <label>优先级<select aria-label="优先级" value={fields.priority} disabled={saving} onChange={event => set({ priority: event.target.value as Task['priority'] })}>
              {priorities.map(priority => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
            </select></label>
            <label>预估耗时（分钟）<input type="number" min={1} max={100_000} step={1} value={fields.estimatedMinutes ?? ''} disabled={saving}
              onChange={event => set({ estimatedMinutes: event.target.value === '' ? null : event.target.valueAsNumber })}/></label>
          </div>
          <div className="widget-form-pair">
            <label>截止日期<WidgetDateField value={fields.dueDate ?? ''} disabled={saving} onChange={event => set({ dueDate: event.target.value || null })}/></label>
            <label>暂缓至<WidgetDateField value={fields.deferredUntil ?? ''} disabled={saving} onChange={event => set({ deferredUntil: event.target.value || null })}/></label>
          </div>
          <label>里程碑<input maxLength={500} value={fields.milestone} disabled={saving} onChange={event => set({ milestone: event.target.value })}/></label>
          <label>备注<textarea maxLength={50_000} rows={3} value={fields.description} disabled={saving} onChange={event => set({ description: event.target.value })}/></label>
          <div className="widget-task-checklist" role="group" aria-label="清单">
            {fields.checklist.map((item, index) => <div key={item.id}>
              <input required aria-label={`清单第 ${index + 1} 项`} maxLength={500} value={item.text} disabled={saving}
                onChange={event => set({ checklist: fields.checklist.map(entry => entry.id === item.id ? { ...entry, text: event.target.value } : entry) })}/>
              <button type="button" className="widget-icon-button" aria-label={`移除清单第 ${index + 1} 项`} disabled={saving}
                onClick={() => set({ checklist: fields.checklist.filter(entry => entry.id !== item.id) })}><X size={16}/></button>
            </div>)}
            <div>
              <input aria-label="添加清单项" placeholder="添加清单项" maxLength={500} value={checklistText} disabled={saving}
                onChange={event => setChecklistText(event.target.value)} onKeyDown={event => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addChecklistItem() }
                }}/>
              <button type="button" className="widget-icon-button" aria-label="添加到清单" disabled={saving || !checklistText.trim() || fields.checklist.length >= 100} onClick={addChecklistItem}><Plus size={20}/></button>
            </div>
          </div>
        </div>}</DesktopDisclosure>
      </>}
      {error && <p className="widget-error" role="alert">{error}</p>}
      <div className="widget-task-save"><button className="widget-primary" disabled={saving} type="submit">{saving ? '保存中…' : task ? '保存更改' : '加入日程'}</button></div>
    </form>
  </WidgetSheet>
}
