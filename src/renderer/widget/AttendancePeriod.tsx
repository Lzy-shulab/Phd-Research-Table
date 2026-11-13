import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { localDay } from '../../shared/arxiv'
import type { ReportSnapshot } from '../../shared/reports'
import type { WidgetPreferences, WidgetPreferencesPatch } from '../../shared/widget'
import { attendanceMonthPeriod, widgetDuration, widgetHours, widgetPatchSchema } from '../../domain/widget'
import { DesktopDisclosure } from './DesktopDisclosure'
import { reducedDesktopMotion } from './desktop-motion'

export function AttendancePeriod({ report, preferences, save, editing }: {
  report: ReportSnapshot | null; preferences: WidgetPreferences | undefined;
  save: (patch: WidgetPreferencesPatch) => Promise<unknown>; editing: (value: boolean) => void
}) {
  const currentMonth = localDay().slice(0, 7)
  const startMonth = preferences?.attendancePeriod?.startMonth ?? currentMonth
  const endMonth = preferences?.attendancePeriod?.endMonth ?? currentMonth
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [start, setStart] = useState(startMonth), [end, setEnd] = useState(endMonth)
  const form = useRef<HTMLFormElement>(null)
  useLayoutEffect(() => { if (open) form.current?.scrollIntoView({ block: 'nearest', behavior: reducedDesktopMotion() ? 'instant' : 'smooth' }) }, [open])
  const statistics = useMemo(() => report ? attendanceMonthPeriod(report, startMonth, endMonth) : null, [report, startMonth, endMonth])
  const toggle = () => { if (!open) { setStart(startMonth); setEnd(endMonth); setError('') }; setOpen(!open); editing(!open) }
  return <section className="attendance-period" aria-label="月份区间打卡统计">
    <header><h2>区间统计</h2><button aria-label="选择统计月份" aria-expanded={open} aria-controls="attendance-period-editor" onClick={toggle} disabled={saving}><span>{startMonth.replace('-', '.')} — {endMonth.replace('-', '.')}</span><CaretDown size={20}/></button></header>
    <div className="attendance-period-total"><span title={statistics ? widgetDuration(statistics.minutes) : undefined}><strong>{statistics ? widgetHours(statistics.minutes) : '—'}</strong><span> / {statistics?.target == null ? '—' : widgetHours(statistics.target)} 小时</span></span><b>{statistics?.percent == null ? '—' : statistics.percent + '%'}</b></div>
    <div className="attendance-period-track" role="progressbar" aria-label="区间打卡进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={statistics?.percent == null ? undefined : Math.min(100, statistics.percent)} aria-valuetext={statistics ? `${widgetDuration(statistics.minutes)}，目标${statistics.target == null ? '未收录' : widgetDuration(statistics.target)}${statistics.percent == null ? '' : `，${statistics.percent}%`}` : '读取中'}><i style={{ transform: `scaleX(${Math.max(0, Math.min(100, statistics?.percent ?? 0)) / 100})` }}/></div>
    <DesktopDisclosure id="attendance-period-editor" open={open}>{() => <form ref={form} className="attendance-period-form" onSubmit={event => {
      event.preventDefault()
      const parsed = widgetPatchSchema.safeParse({ attendancePeriod: { startMonth: start, endMonth: end } })
      if (!parsed.success) { setError(start > end ? '结束月份不能早于开始月份。' : '请选择开始和结束月份。'); return }
      setSaving(true); setError('')
      void save(parsed.data).then(() => { setOpen(false); editing(false) }).catch(() => setError('统计区间未能保存，请重试。')).finally(() => setSaving(false))
    }}>
      <label>开始月份<input type="month" aria-label="统计开始月份" required value={start} onChange={event => setStart(event.target.value)}/></label>
      <label>结束月份<input type="month" aria-label="统计结束月份" required value={end} onChange={event => setEnd(event.target.value)}/></label>
      {error && <p role="alert">{error}</p>}<button type="submit" disabled={saving}>{saving ? '保存中' : '应用区间'}</button>
    </form>}</DesktopDisclosure>
  </section>
}
