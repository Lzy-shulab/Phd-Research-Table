import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, ArrowUpRight, Briefcase as BriefcaseBusiness, Check, CaretDown as ChevronDown, CaretRight as ChevronRight, Coffee, Drop as Droplet, EyeSlash as EyeOff, MapPin, Monitor, PencilSimple as Pencil, PushPin as Pin, Rocket, FloppyDisk as Save, CornersOut as Scan, MagnifyingGlass as Search, Trash as Trash2, X } from '@phosphor-icons/react'
import type { CheckinEntry, CheckinAbsenceEntry, CheckinAbsenceKind, ReportSnapshot } from '../../shared/reports'
import { checkinAbsenceLabels } from '../../shared/reports'
import { checkinDuration, checkinDayParts, checkinInputSchema, checkinStartSchema, checkinAbsenceInputSchema, rangeDays, suggestedCheckinEnd, isOpenCheckin } from '../../domain/reports'
import { widgetAttendanceDays, widgetDuration, type widgetStatistics } from '../../domain/widget'
import { localDay } from '../../shared/arxiv'
import { widgetThemes, widgetThemeLabels, type WidgetCity, type WidgetPreferencesPatch, type WidgetSnapshot } from '../../shared/widget'
import { unwrap } from './api'
import { WidgetDateField, WidgetTimeField } from './fields'

const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。'

function AttendanceDuration({ minutes }: { minutes: number }) {
  return <span className="widget-summary-duration">{widgetDuration(minutes).split(/(\d+)/).filter(Boolean).map((part, index) =>
    <span key={index} className={/^\d+$/.test(part) ? 'duration-number' : 'duration-unit'}>{part}</span>)}</span>
}

export function WidgetSheet({ page, title, close, back, backLabel, children }: { page: string; title: string; close: () => void; back: () => void; backLabel: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const goBack = useRef(back)
  goBack.current = back
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); goBack.current() }
      if (event.key !== 'Tab') return
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])].filter(item => item.getClientRects().length)
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus({ preventScroll: true }) }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus({ preventScroll: true }) }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); previous?.focus({ preventScroll: true }) }
  }, [])
  useLayoutEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const content = ref.current?.querySelector('.widget-sheet-content')
    const animation = content?.animate([{ opacity: .55, transform: 'translateX(8px)' }, { opacity: 1, transform: 'translateX(0)' }],
      { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' })
    return () => animation?.cancel()
  }, [title])
  return <section ref={ref} role="dialog" aria-modal="true" className={`widget-sheet page-${page}`} aria-label={title}>
    <header><button className="widget-icon-button" aria-label={backLabel} onClick={back}><ArrowLeft size={24} strokeWidth={1.6} /></button><h2>{title}</h2><button className="widget-icon-button" aria-label="关闭面板" onClick={close}><X size={23} strokeWidth={1.6} /></button></header>
    <div className="widget-sheet-content">{children}</div>
  </section>
}

export function AttendancePanel({ snapshot, period, statistics, today, month, changeMonth, scrollTop, onScroll, changePeriod, editDay }: {
  snapshot: ReportSnapshot; period: 'week' | 'month'; statistics: ReturnType<typeof widgetStatistics>['week']; today: string
  scrollTop: number; onScroll: (value: number) => void; changePeriod: (period: 'week' | 'month') => void; editDay: (date: string) => void
  month: string; changeMonth: (month: string) => void
}) {
  const { start, end } = statistics.range
  const rows = useMemo(() => widgetAttendanceDays(snapshot, { start, end }, today), [snapshot, start, end, today])
  const list = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (list.current) list.current.scrollTop = scrollTop }, [scrollTop])
  const shortDate = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`
  return <section className={`widget-attendance is-${period}`} aria-label="逐日打卡明细">
    <div className="widget-period-tabs" aria-label="打卡周期">
      <button aria-pressed={period === 'week'} onClick={() => changePeriod('week')}>本周</button>
      <button aria-pressed={period === 'month'} onClick={() => changePeriod('month')}>本月</button>
    </div>
    <div className="widget-attendance-summary">{period === 'month' ? <label className="widget-month-picker"><span>{Number(month.slice(0, 4))}年{Number(month.slice(5))}月</span><ChevronDown size={21} aria-hidden="true" />
      <input type="month" aria-label="选择打卡月份" value={month} onClick={event => event.currentTarget.showPicker()} onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) changeMonth(event.target.value) }} /></label>
      : <span>{shortDate(statistics.range.start)} — {shortDate(statistics.range.end)}</span>}
      <strong><AttendanceDuration minutes={statistics.minutes} /><small>累计时长</small></strong></div>
    <div className="widget-attendance-table" role="table" aria-label={`${period === 'week' ? '本周' : '本月'}每日打卡`}>
      <div className="widget-attendance-columns" role="row"><span role="columnheader">日期</span><span role="columnheader">开始 — 结束</span><span role="columnheader">时长</span></div>
      <div ref={list} className="widget-attendance-list" tabIndex={0} aria-label="滚动查看每天打卡" onScroll={event => onScroll(event.currentTarget.scrollTop)}>
        {rows.map(row => <div className={`widget-attendance-row ${row.isToday ? 'is-today' : ''}`} role="row" key={row.date} data-date={row.date}>
          <div role="cell" className="widget-attendance-date"><button aria-label={`编辑 ${row.date} 打卡`} onClick={() => editDay(row.date)}>
            <strong>{Number(row.date.slice(5, 7))}.{row.date.slice(8)}</strong>
            <span>{row.isToday ? '今天' : new Date(`${row.date}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'short' })}</span></button></div>
          <div role="cell" className="widget-attendance-times">{row.segments.map(segment => <span key={segment.id} title={segment.continuesFromPreviousDay ? '从前一天延续，显示当天部分' : segment.continuesToNextDay ? '延续至次日，显示当天部分' : undefined}>
            {segment.startTime ? segment.endTime ? `${segment.startTime} — ${segment.endTime}` : `${segment.startTime} 打卡中` : '未记录起止时间'}</span>)}
            {!row.segments.length && <span className="widget-attendance-empty">{row.absence ? checkinAbsenceLabels[row.absence.kind] : row.isFuture ? '—' : '未打卡'}</span>}
            {row.absence && row.segments.length > 0 && <small>{checkinAbsenceLabels[row.absence.kind]} · 不计累计</small>}</div>
          <div role="cell" className="widget-attendance-duration">{row.recordedMinutes ? widgetDuration(row.recordedMinutes) : '—'}</div>
        </div>)}
      </div>
    </div>
  </section>
}

export function CheckinPanel({ snapshot, reload, initialDate, initialEntry }: { snapshot: ReportSnapshot; reload: () => Promise<void>; initialDate?: string; initialEntry?: CheckinEntry }) {
  const [date, setDate] = useState(initialEntry?.date ?? initialDate ?? localDay())
  const [startTime, setStart] = useState(initialEntry?.startTime ?? ''), [endTime, setEnd] = useState(initialEntry ? new Date().toTimeString().slice(0, 5) : '')
  const [reminderEnabled, setReminder] = useState(true)
  const [backfill, setBackfill] = useState(Boolean(initialDate && initialDate < localDay()))
  const [endsNextDay, setNextDay] = useState(Boolean(initialEntry && initialEntry.date < localDay())), [notes, setNotes] = useState(initialEntry?.notes ?? '')
  const [editing, setEditing] = useState<CheckinEntry | undefined>(initialEntry), [deleting, setDeleting] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState('')
  const active = snapshot.checkins.find(isOpenCheckin)
  const finishing = editing && isOpenCheckin(editing)
  const enteringEnd = Boolean(editing) || backfill
  const duration = checkinDuration(startTime, endTime, endsNextDay)
  const reminder = reminderEnabled && !enteringEnd ? suggestedCheckinEnd(startTime) : null
  const records = snapshot.checkins.filter(entry => checkinDayParts(entry).some(part => part.date === date))
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  const edit = (entry: CheckinEntry) => {
    const open = isOpenCheckin(entry)
    setDate(entry.date); setStart(entry.startTime ?? ''); setEnd(open ? new Date().toTimeString().slice(0, 5) : entry.endTime ?? '')
    setNextDay(open ? entry.date < localDay() : entry.endsNextDay ?? false)
    setNotes(entry.notes); setEditing(entry); setError(''); setSaved('')
  }
  const clear = () => { setEditing(undefined); setStart(''); setEnd(''); setNotes(''); setNextDay(false); setReminder(true) }
  return <>
    {active && !editing && <button className="widget-active-checkin" onClick={() => edit(active)}><span>{active.date === localDay() ? '' : `${active.date} · `}{active.startTime} 开始</span><strong>结束打卡</strong><ChevronRight size={16}/></button>}
    <form className="widget-form widget-checkin-form" aria-label="分段打卡" onSubmit={event => {
      event.preventDefault()
      setBusy(true); setError(''); setSaved('')
      const save = async () => enteringEnd
        ? unwrap(await window.workbench.saveCheckin(checkinInputSchema.parse({ date, startTime, endTime, endsNextDay, notes }), editing?.id))
        : unwrap(await window.workbench.startCheckin(checkinStartSchema.parse({ date, startTime, notes, reminderEnabled })))
      void save().then(async () => {
        await reload(); clear(); setSaved(finishing ? '打卡已结束' : enteringEnd ? '已保存' : '已开始打卡')
      }).catch(error => setError(message(error))).finally(() => setBusy(false))
    }}>
      {!editing && <div className="widget-checkin-options"><button type="button" className="widget-text-button" aria-pressed={!backfill} onClick={() => { setBackfill(false); setError('') }}>实时打卡</button><button type="button" className="widget-text-button" aria-pressed={backfill} onClick={() => { setBackfill(true); setError('') }}>补录时段</button></div>}
      <label className="widget-date-field">日期<WidgetDateField aria-label="打卡日期" required value={date} disabled={busy} onChange={event => { setDate(event.target.value); setSaved('') }} /></label>
      <div className="widget-form-pair">
        <label>开始时间<WidgetTimeField aria-label="开始时间" required value={startTime} disabled={busy} onChange={event => setStart(event.target.value)} /></label>
        {enteringEnd && <label>实际结束时间<WidgetTimeField aria-label="结束时间" required value={endTime} disabled={busy} onChange={event => setEnd(event.target.value)} /></label>}
      </div>
      <div className="widget-checkin-options">{enteringEnd
        ? <label className="widget-check"><input type="checkbox" checked={endsNextDay} disabled={busy} onChange={event => setNextDay(event.target.checked)} />结束于次日</label>
        : <label className="widget-check"><input type="checkbox" checked={reminderEnabled} disabled={busy} onChange={event => setReminder(event.target.checked)} />12 小时后提醒下班</label>}</div>
      <label className="widget-checkin-notes">备注<textarea aria-label="打卡备注" placeholder="这段时间做了什么" rows={2} maxLength={1000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} /></label>
      <div className="widget-save-row"><output aria-label={enteringEnd ? '本段打卡时长' : '预计提醒时间'}>{enteringEnd ? duration ? widgetDuration(duration) : '—' : reminder ? `${reminder.endsNextDay ? '次日 ' : ''}${reminder.endTime} 提醒` : ''}</output>
        <button className="widget-primary" type="submit" disabled={busy || (!enteringEnd && Boolean(active))}>{busy ? '保存中…' : finishing ? '确认结束' : editing ? '保存修改' : backfill ? '保存打卡' : '开始打卡'}</button></div>
      {editing && <button type="button" className="widget-text-button" onClick={clear}><ArrowLeft size={14} />取消编辑</button>}
      {error && <p className="widget-error" role="alert">{error}</p>}
      {saved && <p className="widget-saved" role="status"><Check size={14} />{saved}</p>}
    </form>
    <div className="widget-records widget-checkin-records" aria-label="当天打卡记录">
      <h3>当天记录</h3>
      {records.map(entry => <div className="widget-record" key={entry.id}>
        <div><strong>{entry.startTime && entry.endTime ? `${entry.date === date ? '' : '前日 '}${entry.startTime} — ${entry.endsNextDay && entry.date === date ? '次日 ' : ''}${entry.endTime}` : isOpenCheckin(entry) ? `${entry.startTime} 开始` : '原有时长记录'}</strong>
          <span>{isOpenCheckin(entry) ? '打卡中' : widgetDuration(checkinDayParts(entry).find(part => part.date === date)?.minutes ?? 0)}</span></div>
        {deleting === entry.id ? <div className="widget-record-actions"><button disabled={busy} onClick={() => {
          setBusy(true); setError('')
          void window.workbench.deleteCheckin(entry.id).then(unwrap).then(reload).then(() => { setDeleting(''); if (editing?.id === entry.id) clear() })
            .catch(error => setError(message(error))).finally(() => setBusy(false))
        }}>删除</button><button onClick={() => setDeleting('')}>取消</button></div>
          : <div className="widget-record-actions"><button aria-label={`编辑打卡 ${entry.id}`} onClick={() => edit(entry)}><Pencil size={21} strokeWidth={1.6} /></button>
            <button aria-label={`删除打卡 ${entry.id}`} onClick={() => setDeleting(entry.id)}><Trash2 size={21} strokeWidth={1.6} /></button></div>}
      </div>)}
      {!records.length && <p className="widget-empty">当天还没有打卡记录</p>}
    </div>
  </>
}

export function AbsencePanel({ kind, snapshot, reload }: { kind: CheckinAbsenceKind; snapshot: ReportSnapshot; reload: () => Promise<void> }) {
  const [startDate, setStart] = useState(localDay()), [endDate, setEnd] = useState(localDay()), [notes, setNotes] = useState('')
  const [editing, setEditing] = useState<string | undefined>(), [deleting, setDeleting] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState('')
  const label = checkinAbsenceLabels[kind]
  const absenceDays = startDate && endDate && endDate >= startDate ? rangeDays({ start: startDate, end: endDate }).length : 0
  const AbsenceIcon = kind === 'trip' ? BriefcaseBusiness : Coffee
  const shortDate = (value: string) => `${Number(value.slice(5, 7))}月${Number(value.slice(8))}日`
  const edit = (entry: CheckinAbsenceEntry) => { setStart(entry.startDate); setEnd(entry.endDate); setNotes(entry.notes); setEditing(entry.id); setSaved(''); setError('') }
  return <div className={`widget-absence-panel is-${kind}`}>
    <div className="widget-absence-summary"><AbsenceIcon size={32} strokeWidth={1.6} aria-hidden="true" /><span>{absenceDays ? `${absenceDays}天 · ${shortDate(startDate)}${startDate === endDate ? '' : ` — ${shortDate(endDate)}`}` : '选择日期'}</span></div>
    <form className="widget-form" aria-label={`${label}日期`} onSubmit={event => {
      event.preventDefault()
      const parsed = checkinAbsenceInputSchema.safeParse({ kind, startDate, endDate, notes })
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查日期。'); return }
      setBusy(true); setError(''); setSaved('')
      void window.workbench.saveCheckinAbsence(parsed.data, editing).then(unwrap).then(async () => { await reload(); setEditing(undefined); setNotes(''); setSaved('已保存') })
        .catch(error => setError(message(error))).finally(() => setBusy(false))
    }}>
      <label className="widget-absence-date"><span>开始日期</span><WidgetDateField aria-label="开始日期" value={startDate} required disabled={busy} onChange={event => {
        setStart(event.target.value); if (event.target.value > endDate) setEnd(event.target.value)
      }} /></label>
      <label className="widget-absence-date"><span>结束日期</span><WidgetDateField aria-label="结束日期" value={endDate} min={startDate} required disabled={busy} onChange={event => setEnd(event.target.value)} /></label>
      <label>备注<input aria-label="出差或休假备注" placeholder="地点或安排（可选）" value={notes} maxLength={1000} disabled={busy} onChange={event => setNotes(event.target.value)} /></label>
      <p className="widget-form-note" title="每天扣减 12 小时目标（含周末和节假日）。">当天打卡不计入累计。</p>
      <button className="widget-primary" disabled={busy}><Save size={27} strokeWidth={1.6} aria-hidden="true" />{busy ? '保存中…' : editing ? '保存修改' : `保存${label}`}</button>
      {editing && <button type="button" className="widget-text-button" onClick={() => { setEditing(undefined); setStart(localDay()); setEnd(localDay()); setNotes('') }}>取消编辑</button>}
      {error && <p className="widget-error" role="alert">{error}</p>}
      {saved && <p className="widget-saved" role="status"><Check size={14} />{saved}</p>}
    </form>
    <div className="widget-records"><h3>已有安排</h3>
      {snapshot.absences.filter(entry => entry.kind === kind).sort((a, b) => b.startDate.localeCompare(a.startDate)).map(entry => <div className="widget-record" key={entry.id}>
        <div><strong>{shortDate(entry.startDate)}{entry.endDate !== entry.startDate && ` — ${shortDate(entry.endDate)}`}</strong><span>{entry.notes || label}</span></div>
        {deleting === entry.id ? <div className="widget-record-actions"><button disabled={busy} onClick={() => {
          setBusy(true); setError('')
          void window.workbench.deleteCheckinAbsence(entry.id).then(unwrap).then(reload).then(() => { setDeleting(''); setEditing(undefined) })
            .catch(error => setError(message(error))).finally(() => setBusy(false))
        }}>删除</button><button onClick={() => setDeleting('')}>取消</button></div>
          : <div className="widget-record-actions"><button aria-label={`编辑${label} ${entry.id}`} onClick={() => edit(entry)}><Pencil size={21} strokeWidth={1.6} /></button>
            <button aria-label={`删除${label} ${entry.id}`} onClick={() => setDeleting(entry.id)}><Trash2 size={21} strokeWidth={1.6} /></button></div>}
      </div>)}
    </div>
      {!snapshot.absences.some(entry => entry.kind === kind) && <p className="widget-empty">暂无{label}安排</p>}
  </div>
}

export function CityPanel({ choose, selectedCityId }: { choose: (city: WidgetCity) => Promise<void>; selectedCityId?: number }) {
  const [query, setQuery] = useState(''), [cities, setCities] = useState<WidgetCity[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [searched, setSearched] = useState(false)
  return <div className="widget-city-panel">
    <label className="widget-search-label" htmlFor="widget-city-query">城市名称</label>
    <form className="widget-city-search" onSubmit={event => {
      event.preventDefault(); setBusy(true); setError(''); setSearched(false)
      void window.workbench.searchWidgetCities(query).then(unwrap).then(cities => { setCities(cities); setSearched(true) })
        .catch(error => setError(message(error))).finally(() => setBusy(false))
    }}><Search size={23} strokeWidth={1.7} aria-hidden="true" /><input id="widget-city-query" aria-label="搜索城市" placeholder="例如：上海" value={query} minLength={2} maxLength={100} required onChange={event => setQuery(event.target.value)} />
      <button type="submit" className="widget-primary" disabled={busy}>{busy ? '搜索中' : '搜索'}</button></form>
    {error && <p className="widget-error" role="alert">{error}</p>}
    {cities.length > 0 && <h3 className="widget-results-title">搜索结果</h3>}
    <div className="widget-city-results">{cities.map(city => <button key={city.id} aria-pressed={city.id === selectedCityId} disabled={busy} onClick={() => {
      setBusy(true); void choose(city).catch(error => setError(message(error))).finally(() => setBusy(false))
    }}><MapPin size={27} strokeWidth={1.6} aria-hidden="true" /><div><strong>{city.name}</strong><span>{[city.country, city.region].filter(Boolean).join(' · ')}</span></div><ChevronRight size={21} strokeWidth={1.6} aria-hidden="true" /></button>)}</div>
    
    {searched && !cities.length && <p className="widget-empty">未找到城市，可尝试英文名称。</p>}
    <p className="widget-attribution">天气：Open-Meteo · 地名：GeoNames</p>
  </div>
}

export function PreferencesPanel({ snapshot, update, openCity }: {
  snapshot: WidgetSnapshot; update: (patch: WidgetPreferencesPatch) => Promise<void>; openCity: () => void
}) {
  const [error, setError] = useState('')
  const [opacity, setOpacity] = useState(snapshot.preferences.glassOpacity)
  const [scale, setScale] = useState(snapshot.scale)
  useEffect(() => { setScale(snapshot.scale) }, [snapshot.scale])
  const [busy, setBusy] = useState(false)
  const save = (patch: WidgetPreferencesPatch) => {
    setBusy(true); setError('')
    void update(patch).catch(error => setError(message(error))).finally(() => setBusy(false))
  }
  return <div className="widget-preferences">
    <section className="widget-settings-group" aria-label="显示"><h3>显示</h3>
    <fieldset className="widget-theme-picker" disabled={busy}>
      <legend>背景颜色</legend>
      <div className="widget-theme-options">
        {widgetThemes.map(theme => <label className="widget-theme-option" key={theme} data-widget-theme={theme}>
          <input type="radio" name="widget-theme" checked={snapshot.preferences.theme === theme} onChange={() => save({ theme })} />
          <span>{widgetThemeLabels[theme]}</span>
          <span className="widget-theme-swatches" aria-hidden="true"><i/><i/><i/></span>
        </label>)}
      </div>
    </fieldset>
    <label className="widget-switch"><span><Monitor size={17} aria-hidden="true" />自动适配屏幕</span><input type="checkbox" role="switch" checked={snapshot.preferences.scale === null} disabled={busy}
      onChange={event => save({ scale: event.target.checked ? null : snapshot.scale })} /></label>
    <label className="widget-scale"><span><Scan size={17} aria-hidden="true" />面板大小<output>{Math.round(scale * 100)}%</output></span>
      <input type="range" aria-label="面板大小" min="0.6" max="1" step="0.05" value={scale} disabled={busy || snapshot.preferences.scale === null}
        style={{ '--range-position': `${(scale - .6) / .4 * 100}%` } as CSSProperties}
        onChange={event => setScale(Number(event.target.value))} onPointerUp={() => save({ scale })}
        onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) save({ scale }) }} /></label>
    <label className="widget-opacity"><span><Droplet size={17} aria-hidden="true" />玻璃浓度<output>{Math.round(opacity * 100)}%</output></span><input type="range" aria-label="玻璃浓度" min="0.35" max="0.9" step="0.05" value={opacity} disabled={busy}
      style={{ '--range-position': `${(opacity - .35) / .55 * 100}%` } as CSSProperties}
      onChange={event => { setOpacity(Number(event.target.value)); document.documentElement.style.setProperty('--glass-opacity', event.target.value) }} onPointerUp={() => save({ glassOpacity: opacity })} onKeyUp={event => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) save({ glassOpacity: opacity })
      }} /></label></section>
    <section className="widget-settings-group" aria-label="行为"><h3>行为</h3>
    <label className="widget-switch"><span><Rocket size={22} strokeWidth={1.6} aria-hidden="true" />开机启动面板</span><input type="checkbox" role="switch" checked={snapshot.preferences.openAtLogin} disabled={busy} onChange={event => save({ openAtLogin: event.target.checked })} /></label>
    <label className="widget-switch"><span><Pin size={17} aria-hidden="true" />始终置顶</span><input type="checkbox" role="switch" checked={snapshot.preferences.alwaysOnTop} disabled={busy} onChange={event => save({ alwaysOnTop: event.target.checked })} /></label></section>
    <button className="widget-setting-action" onClick={openCity}><MapPin size={17} aria-hidden="true" />天气城市<span>{snapshot.preferences.city?.name ?? '未设置'}</span><ChevronRight size={15} aria-hidden="true" /></button>
    <button className="widget-setting-action" onClick={() => { void window.workbench.openWorkbench().then(unwrap).catch(error => setError(message(error))) }}><ArrowUpRight size={22} aria-hidden="true" />打开 PhD 工作台<ArrowUpRight className="widget-setting-trailing" size={21} aria-hidden="true" /></button>
    <button className="widget-setting-action" onClick={() => { void window.workbench.hideWidget().then(unwrap).catch(error => setError(message(error))) }}><EyeOff size={22} aria-hidden="true" />暂时隐藏面板<ChevronRight className="widget-setting-trailing" size={21} aria-hidden="true" /></button>
    {snapshot.startupError && <p className="widget-error" role="alert">{snapshot.startupError}</p>}
    {error && <p className="widget-error" role="alert">{error}</p>}
  </div>
}
