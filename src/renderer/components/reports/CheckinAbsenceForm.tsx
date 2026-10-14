import { useState } from 'react'
import { motion } from 'motion/react'
import { localDay } from '../../../shared/arxiv'
import { checkinAbsenceLabels, type CheckinAbsenceEntry, type CheckinAbsenceInput, type CheckinAbsenceKind } from '../../../shared/reports'
import { checkinAbsenceInputSchema } from '../../../domain/reports'
import { Button } from '../ui/button'

export function CheckinAbsenceForm({ entry, kind, busy, save, cancel }: {
  entry: CheckinAbsenceEntry | null; kind: CheckinAbsenceKind; busy: boolean
  save: (input: CheckinAbsenceInput) => Promise<void>; cancel: () => void
}) {
  const [draft, setDraft] = useState<CheckinAbsenceInput>(() => entry ?? { kind, startDate: localDay(), endDate: localDay(), notes: '' })
  const [error, setError] = useState('')
  const label = checkinAbsenceLabels[draft.kind]
  return <motion.form aria-label="出差与休假日期" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="report-entry-form report-absence-form" onSubmit={event => {
    event.preventDefault()
    const parsed = checkinAbsenceInputSchema.safeParse({ kind: draft.kind, startDate: draft.startDate, endDate: draft.endDate, notes: draft.notes })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查日期。'); return }
    setError(''); void save(parsed.data)
  }}>
    <label className="field">类型<select aria-label="出差或休假类型" value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as CheckinAbsenceKind })}><option value="trip">出差</option><option value="leave">休假</option></select></label>
    <label className="field">开始日期<input aria-label="出差或休假开始日期" type="date" required value={draft.startDate} onChange={event => setDraft({ ...draft, startDate: event.target.value, endDate: draft.endDate < event.target.value ? event.target.value : draft.endDate })} /></label>
    <label className="field">结束日期<input aria-label="出差或休假结束日期" type="date" required min={draft.startDate} value={draft.endDate} onChange={event => setDraft({ ...draft, endDate: event.target.value })} /></label>
    <label className="field">备注（选填）<input aria-label="出差或休假备注" maxLength={1000} value={draft.notes} placeholder="如会议出差、年假" onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
    <p className="report-entry-notice">单日请填写相同的起止日期。区间内每天从周、月目标扣除 12 小时，周末和节假日同样扣除；当天打卡不计入累计。</p>
    {error && <p className="report-entry-notice report-error" role="alert">{error}</p>}
    <div className="report-form-actions"><Button type="submit" variant="primary" disabled={busy}>{entry ? '保存日期修改' : `保存${label}日期`}</Button><Button disabled={busy} onClick={cancel}>取消</Button></div>
  </motion.form>
}
