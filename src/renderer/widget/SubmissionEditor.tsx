import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react'
import type { Submission, SubmissionProgressPatch, SubmissionStageInput } from '../../shared/types'
import { localDay } from '../../shared/arxiv'
import { WidgetDateField } from './fields'
import { WidgetSheet } from './panels'

type Props = {
  submission: Submission
  saving: boolean
  error: string
  clearError: () => void
  close: () => void
  save: (patch: SubmissionProgressPatch) => void
}

function editableFields(submission: Submission) {
  const { title, journal, manuscriptId, revisionDueDate, revisionCompleted, ended, reminderEnabled, reminderDays, notes } = submission
  return { title, journal, manuscriptId, revisionDueDate, revisionCompleted, ended, reminderEnabled, reminderDays, notes }
}

export function SubmissionEditor({ submission, saving, error, clearError, close, save }: Props) {
  const [fields, setFields] = useState(() => editableFields(submission))
  const [stages, setStages] = useState<(SubmissionStageInput & { key: string })[]>(() =>
    submission.stages.map(({ id, name, occurredOn }) => ({ key: id, id, name, occurredOn })))
  const set = (patch: Partial<typeof fields>) => setFields(current => ({ ...current, ...patch }))
  const changeStage = (key: string, patch: Partial<SubmissionStageInput>) =>
    setStages(current => current.map(stage => stage.key === key ? { ...stage, ...patch } : stage))
  const moveStage = (index: number, offset: -1 | 1) => setStages(current => {
    const next = [...current]
    const target = index + offset
    const [stage] = next.splice(index, 1)
    next.splice(target, 0, stage!)
    return next
  })

  return <WidgetSheet page="submission-editor" title="编辑投稿" backLabel="返回论文投稿" close={close} back={close}>
    <form className="submission-editor" onChange={clearError} onSubmit={event => {
      event.preventDefault()
      if (saving) return
      const previous = editableFields(submission)
      const patch: SubmissionProgressPatch = Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== previous[key as keyof typeof previous]))
      const timeline = stages.map(({ id, name, occurredOn }) => ({ id, name, occurredOn }))
      if (JSON.stringify(timeline) !== JSON.stringify(submission.stages.map(({ id, name, occurredOn }) => ({ id, name, occurredOn })))) patch.stages = timeline
      save(patch)
    }}>
      <div className="widget-form submission-editor-fields">
        <p className="submission-editor-title">{submission.title}</p>
        <fieldset className="submission-stage-fields" disabled={saving}>
          <legend>投稿历程</legend>
          {stages.length > 1 && <p className="widget-form-note">按日期先后排列，首个日期为投稿日期。</p>}
          {stages.map((stage, index) => <div className="submission-edit-stage" key={stage.key} role="group" aria-label={`阶段 ${index + 1}`}>
            <div className="submission-stage-tools">
              <span>阶段 {index + 1}</span>
              <button type="button" aria-label={`上移阶段 ${index + 1}`} disabled={index === 0} onClick={() => moveStage(index, -1)}><ArrowUp size={18}/></button>
              <button type="button" aria-label={`下移阶段 ${index + 1}`} disabled={index === stages.length - 1} onClick={() => moveStage(index, 1)}><ArrowDown size={18}/></button>
              <button type="button" aria-label={`移除阶段 ${index + 1}`} onClick={() => setStages(current => current.filter(item => item.key !== stage.key))}><Trash size={18}/></button>
            </div>
            <div className="widget-form-pair">
              <label>状态名称<input aria-label={`阶段 ${index + 1} 状态名称`} required maxLength={160} value={stage.name} onChange={event => changeStage(stage.key, { name: event.target.value })}/></label>
              <label>日期<WidgetDateField aria-label={`阶段 ${index + 1} 日期`} required value={stage.occurredOn} onChange={event => changeStage(stage.key, { occurredOn: event.target.value })}/></label>
            </div>
          </div>)}
          <button className="submission-add-action" type="button" disabled={stages.length >= 30} onClick={() => {
            const today = localDay()
            const latest = stages.at(-1)?.occurredOn ?? ''
            setStages(current => [...current, { key: crypto.randomUUID(), name: '', occurredOn: latest > today ? latest : today }])
          }}><Plus size={18}/>添加阶段</button>
        </fieldset>
        <label>返修截止日期<WidgetDateField value={fields.revisionDueDate ?? ''} disabled={saving} onChange={event => set({ revisionDueDate: event.target.value || null })}/></label>
        <label className="widget-check"><input type="checkbox" checked={fields.revisionCompleted} disabled={saving} onChange={event => set({ revisionCompleted: event.target.checked })}/>本轮返修已完成</label>
        <label className="widget-check"><input type="checkbox" checked={fields.ended} disabled={saving} onChange={event => set({ ended: event.target.checked })}/>投稿已结束</label>
        <details className="submission-other-fields">
          <summary>稿件信息与提醒</summary>
          <div className="widget-form">
            <label>论文标题<textarea required maxLength={1000} rows={2} value={fields.title} disabled={saving} onChange={event => set({ title: event.target.value })}/></label>
            <label>期刊 / 会议<input required maxLength={500} value={fields.journal} disabled={saving} onChange={event => set({ journal: event.target.value })}/></label>
            <label>稿件编号<input maxLength={200} value={fields.manuscriptId} disabled={saving} onChange={event => set({ manuscriptId: event.target.value })}/></label>
            <label className="widget-check"><input type="checkbox" checked={fields.reminderEnabled} disabled={saving} onChange={event => set({ reminderEnabled: event.target.checked })}/>启用返修提醒</label>
            {fields.reminderEnabled && <label>返修提前提醒<select value={fields.reminderDays} disabled={saving} onChange={event => set({ reminderDays: Number(event.target.value) })}>
              {[...new Set([0, 1, 3, 7, fields.reminderDays])].sort((a, b) => a - b).map(days =>
                <option key={days} value={days}>{days === 0 ? '截止当天' : `提前 ${days} 天`}</option>)}
            </select></label>}
            <label>备注<textarea maxLength={50000} rows={3} value={fields.notes} disabled={saving} onChange={event => set({ notes: event.target.value })}/></label>
          </div>
        </details>
      </div>
      <div className="submission-editor-footer">
        {error && <p className="desktop-error" role="alert">{error}</p>}
        <button className="widget-primary" type="submit" disabled={saving}>{saving ? '正在保存…' : '保存投稿'}</button>
      </div>
    </form>
  </WidgetSheet>
}
