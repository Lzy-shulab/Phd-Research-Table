import { useState } from 'react'
import { ArrowDown, ArrowUp, Bell, Plus, Trash2 } from 'lucide-react'
import type { Submission, SubmissionInput, SubmissionStageInput } from '../../../shared/types'
import { submissionSchema } from '../../../domain/submissions'
import { localDay } from '../../../shared/arxiv'
import { useSubmissions } from '../../stores/submissions'
import { Button } from '../ui/button'
import { ConfirmDialog, Dialog } from '../ui/dialog'

export function SubmissionDialog({ submission, onClose }: { submission?: Submission; onClose: () => void }) {
  const [draft, setDraft] = useState<SubmissionInput>(() => submission ? {
    title: submission.title, journal: submission.journal, manuscriptId: submission.manuscriptId,
    stages: submission.stages.map(({ id, name, occurredOn }) => ({ id, name, occurredOn })),
    revisionDueDate: submission.revisionDueDate, reminderEnabled: submission.reminderEnabled, reminderDays: submission.reminderDays, notes: submission.notes
  } : { title: '', journal: '', manuscriptId: '', stages: [{ name: '', occurredOn: localDay() }], revisionDueDate: null, reminderEnabled: true, reminderDays: 3, notes: '' })
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [remove, setRemove] = useState(false)
  const patch = (input: Partial<SubmissionInput>) => setDraft((current) => ({ ...current, ...input }))
  const patchStage = (index: number, input: Partial<SubmissionStageInput>) => patch({ stages: draft.stages.map((stage, own) => own === index ? { ...stage, ...input } : stage) })
  const moveStage = (index: number, offset: -1 | 1) => {
    const stages = [...draft.stages], target = index + offset
    if (!stages[index] || !stages[target]) return
    ;[stages[index], stages[target]] = [stages[target]!, stages[index]!]
    patch({ stages })
  }
  return <><Dialog open className="submission-dialog" title={submission ? '更新投稿记录' : '新增投稿记录'} description="按期刊系统原文记录状态和日期；时间线只展示你已经添加的状态。" onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <form className="project-form" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return
      const parsed = submissionSchema.safeParse(draft)
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查填写内容。'); return }
      setBusy(true); setError('')
      try {
        const result = submission ? await window.workbench.updateSubmission(submission.id, parsed.data) : await window.workbench.createSubmission(parsed.data)
        if (!result.ok) { setError(result.error.message); return }
        await useSubmissions.getState().load(); onClose()
      } catch { setError('投稿记录未能保存，请重试。') }
      finally { setBusy(false) }
    }}>
      <label className="field">论文标题<textarea aria-label="投稿论文标题" value={draft.title} rows={2} required maxLength={1000} onChange={(event) => patch({ title: event.target.value })} /></label>
      <label className="field">期刊 / 会议<input aria-label="投稿期刊或会议" value={draft.journal} required maxLength={500} placeholder="填写本次投稿的期刊或会议" onChange={(event) => patch({ journal: event.target.value })} /></label>
      <label className="field">稿件编号<input aria-label="稿件编号" value={draft.manuscriptId} maxLength={200} placeholder="可选，例如期刊系统分配的编号" onChange={(event) => patch({ manuscriptId: event.target.value })} /></label>
      <fieldset className="submission-stage-editor"><legend>投稿状态</legend>
        <p className="field-hint">状态名称可使用期刊系统原文；首个状态日期同时作为投稿时间。状态按这里的顺序显示，日期应从早到晚。</p>
        {draft.stages.length ? <div className="submission-stage-rows">{draft.stages.map((stage, index) => <div className="submission-stage-row" key={stage.id ?? `new-${index}`}>
          <span className="submission-stage-number">{index + 1}</span>
          <label className="field">状态名称<input aria-label={`状态 ${index + 1} 名称`} value={stage.name} required maxLength={160} placeholder={index === 0 ? '例如 Submitted to Journal' : '例如 With editor'} onChange={(event) => patchStage(index, { name: event.target.value })} /></label>
          <label className="field submission-stage-date">状态日期<input aria-label={`状态 ${index + 1} 日期`} type="date" required value={stage.occurredOn} onChange={(event) => patchStage(index, { occurredOn: event.target.value })} /></label>
          <div className="submission-stage-row-actions"><Button variant="ghost" className="icon-button" aria-label={`上移状态 ${index + 1}`} title="上移" disabled={index === 0} onClick={() => moveStage(index, -1)}><ArrowUp size={15} /></Button>
            <Button variant="ghost" className="icon-button" aria-label={`下移状态 ${index + 1}`} title="下移" disabled={index === draft.stages.length - 1} onClick={() => moveStage(index, 1)}><ArrowDown size={15} /></Button>
            <Button variant="ghost" className="icon-button danger-text" aria-label={`删除状态 ${index + 1}`} title="删除状态" onClick={() => patch({ stages: draft.stages.filter((_, own) => own !== index) })}><Trash2 size={15} /></Button></div>
        </div>)}</div> : <p className="submission-stage-empty">尚未添加状态；保存后卡片会显示“暂无状态”。</p>}
        <Button className="submission-add-stage" disabled={draft.stages.length >= 30} onClick={() => patch({ stages: [...draft.stages, { name: '', occurredOn: draft.stages.at(-1)?.occurredOn ?? localDay() }] })}><Plus size={15} />添加状态</Button>
      </fieldset>
      <div className="submission-reminder-fields"><label className="field">返修截止日期<input aria-label="返修截止日期" type="date" value={draft.revisionDueDate ?? ''} onChange={(event) => patch({ revisionDueDate: event.target.value || null })} /></label>
        <div className="submission-reminder-options"><label><Bell size={15} /><span>返修提醒</span><input aria-label="启用返修提醒" type="checkbox" role="switch" checked={draft.reminderEnabled} onChange={(event) => patch({ reminderEnabled: event.target.checked })} /></label>
          <select aria-label="返修提前提醒天数" disabled={!draft.reminderEnabled} value={draft.reminderDays} onChange={(event) => patch({ reminderDays: Number(event.target.value) })}><option value={0}>截止当天</option><option value={1}>提前 1 天</option><option value={3}>提前 3 天</option><option value={7}>提前 7 天</option>{![0, 1, 3, 7].includes(draft.reminderDays) && <option value={draft.reminderDays}>提前 {draft.reminderDays} 天</option>}</select></div>
        <p className="field-hint">有返修截止日期并开启提醒时生效。应用运行时发送系统通知，重新打开时补查；关闭期间不发送通知。</p></div>
      <label className="field">备注<textarea aria-label="投稿备注" rows={2} value={draft.notes} maxLength={50000} placeholder="记录审稿意见、返修重点或转投原因…" onChange={(event) => patch({ notes: event.target.value })} /></label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions">{submission && <Button variant="ghost" className="danger-text push-right" disabled={busy} onClick={() => setRemove(true)}><Trash2 size={14} />删除记录</Button>}
        <Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存投稿记录'}</Button></div>
    </form>
  </Dialog><ConfirmDialog open={remove} busy={busy} title="删除这条投稿记录？" description="该记录及阶段变更时间线将一起删除。已发表成果和文献库中的 PDF 不受影响。" onClose={() => setRemove(false)} onConfirm={async () => {
    if (!submission) return
    setBusy(true)
    try { const result = await window.workbench.deleteSubmission(submission.id); if (!result.ok) { setError(result.error.message); setRemove(false); return } await useSubmissions.getState().load(); onClose() }
    catch { setError('删除未完成，请重试。'); setRemove(false) }
    finally { setBusy(false) }
  }} /></>
}
