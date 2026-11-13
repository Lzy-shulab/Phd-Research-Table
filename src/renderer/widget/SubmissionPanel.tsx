import { useCallback, useEffect, useState } from 'react'
import { CaretDown, CalendarBlank, CheckCircle, PaperPlaneTilt, ClockCounterClockwise, ArrowCounterClockwise, PencilSimple } from '@phosphor-icons/react'
import type { Submission, SubmissionProgressPatch } from '../../shared/types'
import { localDay } from '../../shared/arxiv'
import { daysUntil } from '../../shared/submissions'
import { PanelFrame } from './PanelFrame'
import { PanelFooter } from './PanelFooter'
import { DesktopTabs } from './DesktopTabs'
import { DesktopDisclosure } from './DesktopDisclosure'
import { SubmissionEditor } from './SubmissionEditor'
import { unwrap } from './api'
import './submission-panel.css'

export function SubmissionPanel() {
  const [items, setItems] = useState<Submission[]>([]), [filter, setFilter] = useState('active')
  const [selected, setSelected] = useState<string | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [editing, setEditing] = useState<Submission | null>(null)
  const [saved, setSaved] = useState('')
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : '读取投稿失败，请重试。')
  const reload = useCallback(async () => { setItems(unwrap(await window.workbench.submissionsSnapshot()).submissions); setUpdatedAt(Date.now()); setLoading(false) }, [])
  useEffect(() => { void reload().catch(e => { fail(e); setLoading(false) }); return window.workbench.onSubmissionsChanged(() => { void reload().catch(fail) }) }, [reload])
  const completeRevision = async (item: Submission) => {
    setSaving(true)
    try {
      unwrap(await window.workbench.setRevisionCompleted(item.id, !item.revisionCompleted)); await reload(); setError('')
    } catch(e) { fail(e) } finally { setSaving(false) }
  }
  const closeEditor = () => { if (!saving) { setEditing(null); setError('') } }
  const saveProgress = async (patch: SubmissionProgressPatch) => {
    if (!editing || saving) return
    if (!Object.keys(patch).length) { closeEditor(); return }
    setSaving(true); setError('')
    try {
      const updated = unwrap(await window.workbench.updateSubmissionProgress(editing.id, patch))
      setItems(current => current.map(item => item.id === updated.id ? updated : item))
      setFilter(updated.ended ? 'ended' : filter === 'revision' && updated.revisionDueDate && !updated.revisionCompleted ? 'revision' : 'active')
      setUpdatedAt(Date.now()); setSaved('投稿已保存'); setEditing(null)
    } catch (error) { fail(error) }
    finally { setSaving(false) }
  }
  const visible = items.filter(s => filter === 'ended' ? s.ended : !s.ended && (filter !== 'revision' || s.revisionDueDate && !s.revisionCompleted))
    .sort((a,b) => (a.revisionDueDate ?? '9999').localeCompare(b.revisionDueDate ?? '9999'))
  const counts = { active: items.filter(s => !s.ended).length, revision: items.filter(s => !s.ended && s.revisionDueDate && !s.revisionCompleted).length, ended: items.filter(s => s.ended).length }
  const today = localDay()
  return <><PanelFrame title="论文投稿" covered={Boolean(editing)} busy={Boolean(editing) || saving} footer={<PanelFooter updatedAt={updatedAt} status={saving ? '保存中' : error ? '更新失败' : saved || undefined} busy={loading || saving} refreshLabel="刷新投稿" onRefresh={() => { setLoading(true); setSaved(''); void reload().then(() => setError('')).catch(e => { fail(e); setLoading(false) }) }}/> }>
    <DesktopTabs label="投稿范围" selected={filter} className="submission-tabs">{([['active','进行中'],['revision','待返修'],['ended','已结束']] as const).map(([key,label]) => <button key={key} role="tab" aria-label={label} aria-selected={filter === key} onClick={() => { setFilter(key); setSelected(null) }}><span>{label}</span><small aria-hidden="true">{counts[key]}</small></button>)}</DesktopTabs>
    {error && <button className="desktop-error" role="alert" onClick={() => { void reload().then(() => setError('')).catch(fail) }}>{error}</button>}
    <div className="submission-list">
      {loading ? <div className="desktop-quiet-empty" role="status" aria-label="加载投稿"><span className="desktop-spinner"/></div> : !visible.length ? <div className="desktop-quiet-empty"><PaperPlaneTilt size={40} weight="duotone"/><span>暂无{filter === 'revision' ? '待返修' : filter === 'ended' ? '已结束' : '进行中'}投稿</span></div> : visible.map(item => {
        const expanded = selected === item.id
        const days = item.revisionDueDate && !item.revisionCompleted && !item.ended ? daysUntil(item.revisionDueDate, today) : null
        const lastStage = item.stages.at(-1)
        return <article className={`submission-entry${expanded ? ' is-expanded' : ''}${item.ended ? ' is-ended' : ''}${days !== null && days <= 3 ? ' is-urgent' : ''}`} key={item.id}>
          <div className="submission-entry-top">
            <span className="submission-stage-tag"><i/>{item.currentStage || (item.ended ? '已结束' : '进行中')}</span>
            <button className="submission-edit-action" type="button" aria-label={`编辑投稿：${item.title}`} title="编辑投稿" disabled={saving} onClick={() => { setSelected(item.id); setEditing(item); setError(''); setSaved('') }}><PencilSimple size={19}/><span>编辑</span></button>
          </div>
          <button className="desktop-submission-heading" aria-label={item.title} aria-expanded={expanded} aria-controls={`submission-${item.id}`} onClick={() => setSelected(expanded ? null : item.id)}><span className="submission-heading-copy"><span className="submission-journal">{item.journal}</span><span className="submission-title">{item.title}</span></span><CaretDown size={24}/></button>
          {days !== null ? <div className="submission-deadline"><CalendarBlank size={24}/><div><span>返修截止</span><time dateTime={item.revisionDueDate!}>{item.revisionDueDate!.replaceAll('-', '.')}</time></div><strong>{days === 0 ? '今天' : <>{days < 0 && <em>逾期</em>}{Math.abs(days)}<small>天</small></>}</strong></div>
            : <div className="submission-last-event"><ClockCounterClockwise size={20}/><time dateTime={lastStage?.occurredOn}>{lastStage?.occurredOn.replaceAll('-', '.') ?? '待更新进展'}</time>{item.revisionCompleted && <span><CheckCircle size={20}/>返修已完成</span>}</div>}
          <DesktopDisclosure open={expanded} id={`submission-${item.id}`}>{() => <div className="submission-expanded">
            {item.manuscriptId && <div className="submission-manuscript"><span>稿件编号</span><strong>{item.manuscriptId}</strong></div>}
            <ol className="submission-timeline" aria-label="投稿历程">{item.stages.map((stage, index) => <li key={stage.id} className={index === item.stages.length - 1 ? 'is-current' : ''}><time dateTime={stage.occurredOn}>{stage.occurredOn.replaceAll('-', '.')}</time><i aria-hidden="true"/><span>{stage.name}</span></li>)}</ol>
            {item.revisionDueDate && <button className="submission-revision-action" disabled={saving} onClick={() => { void completeRevision(item) }}>{item.revisionCompleted ? <ArrowCounterClockwise size={24}/> : <CheckCircle size={24}/>}<span>{item.revisionCompleted ? '重新打开返修' : '标记返修完成'}</span></button>}
            {item.notes && <p className="desktop-notes">{item.notes}</p>}
          </div>}</DesktopDisclosure>
        </article>
      })}
    </div>
  </PanelFrame>
    {editing && <SubmissionEditor submission={editing} saving={saving} error={error} clearError={() => { setError('') }} close={closeEditor} save={patch => { void saveProgress(patch) }}/>}
  </>
}
