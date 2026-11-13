import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Briefcase as BriefcaseBusiness, Coffee, CaretRight as ChevronRight, SlidersHorizontal as Settings2, CornersOut as Scan, Square, CloudSun, PlusCircle, Drop, BellSlash } from '@phosphor-icons/react'
import { checkinDayParts, isOpenCheckin } from '../../domain/reports'
import type { CheckinEntry, ReportSnapshot } from '../../shared/reports'
import { checkinAbsenceLabels } from '../../shared/reports'
import type { WidgetSnapshot, WidgetPreferencesPatch, WidgetWeatherSnapshot } from '../../shared/widget'
import { widgetStatistics, widgetDuration, widgetHours, focusElapsed } from '../../domain/widget'
import { AbsencePanel, AttendancePanel, CheckinPanel, CityPanel, PreferencesPanel, WidgetSheet } from './panels'
import { PanelFrame } from './PanelFrame'
import { PanelFooter } from './PanelFooter'
import { AttendancePeriod } from './AttendancePeriod'
import { ProgressRing } from './ProgressRing'
import { unwrap } from './api'
import { localDay } from '../../shared/arxiv'

type Sheet = 'week' | 'month' | 'checkin' | 'trip' | 'leave' | 'city' | 'settings' | null
export function WidgetApp() {
  const [report, setReport] = useState<ReportSnapshot | null>(null), [snapshot, setSnapshot] = useState<WidgetSnapshot | null>(null)
  const [now, setNow] = useState(Date.now()), [error, setError] = useState('')
  const [sheet, setSheet] = useState<Sheet>(null)
  const [parent, setParent] = useState<Sheet>(null)
  const [date, setDate] = useState<string>(), [month, setMonth] = useState(() => localDay().slice(0,7))
  const [checkinEntry, setCheckinEntry] = useState<CheckinEntry>()
  const scroll = useRef({ week: 0, month: 0 })
  const focusInput = useRef<HTMLInputElement>(null)
  const [started, setStarted] = useState<number | null>(null), [focusText, setFocusText] = useState('')
  const [weather, setWeather] = useState<WidgetWeatherSnapshot>()
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [periodEditing, setPeriodEditing] = useState(false)
  const [waterBusy, setWaterBusy] = useState(false), [waterError, setWaterError] = useState('')
  const waterDueAt = snapshot?.waterReminderAt ?? null
  const waterSeconds = waterDueAt === null ? null : Math.max(0, Math.ceil((waterDueAt - now) / 1000))
  const waterCounting = waterSeconds !== null && waterSeconds > 0
  const updateWater = async (action: 'restart' | 'stop') => {
    setWaterBusy(true); setWaterError('')
    try {
      const next = unwrap(await window.workbench.updateWaterReminder(action))
      setNow(Date.now()); setSnapshot(next)
    } catch (e) {
      setWaterError(e instanceof Error ? e.message : '喝水提醒更新失败，请重试。')
    } finally { setWaterBusy(false) }
  }
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : '读取失败，请重试。')
  const reload = useCallback(async () => { setReport(unwrap(await window.workbench.researchReport())); setUpdatedAt(Date.now()); setError('') }, [])
  useEffect(() => {
    void reload().catch(fail)
    void window.workbench.widgetSnapshot().then(unwrap).then(s => { setSnapshot(s); setFocusText(s.preferences.focusText) }).catch(fail)
    void window.workbench.widgetWeather().then(unwrap).then(setWeather).catch(() => {})
    const off = window.workbench.onReportsChanged(() => { void reload().catch(fail) })
    const offWidget = window.workbench.onWidgetChanged(next => {
      setSnapshot(next)
      if (document.activeElement !== focusInput.current) setFocusText(next.preferences.focusText)
    })
    return () => { off(); offWidget() }
  }, [reload])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      clearTimeout(timer)
      setNow(Date.now())
      if (!document.hidden) timer = setTimeout(tick, started !== null || waterCounting ? 1000 : 60_000 - Date.now() % 60_000)
    }
    const off = window.workbench.onDesktopPanelShown(tick)
    document.addEventListener('visibilitychange', tick)
    tick()
    return () => { clearTimeout(timer); off(); document.removeEventListener('visibilitychange', tick) }
  }, [started, waterCounting])
  const update = async (patch: WidgetPreferencesPatch) => setSnapshot(unwrap(await window.workbench.updateWidgetPreferences(patch)))
  const today = localDay(new Date(now))
  const stats = useMemo(() => report ? widgetStatistics(report, new Date(today + 'T12:00:00')) : null, [report, today])
  const active = report?.checkins.find(isOpenCheckin)
  const showDay = (day?: string, entry?: CheckinEntry) => { setDate(day); setCheckinEntry(entry); setParent(sheet); setSheet('checkin') }
  const close = () => { setSheet(null); setParent(null) }
  const title = sheet === 'week' ? '本周打卡' : sheet === 'month' ? '本月打卡' : sheet === 'checkin' ? '研究打卡' : sheet === 'city' ? '天气城市' : sheet === 'settings' ? '面板设置' : sheet === 'trip' ? '增加出差' : '增加休假'
  const selected = useMemo(() => report && stats ? sheet === 'month' ? widgetStatistics(report, new Date(month + '-15T12:00:00')).month : stats.week : null, [report, stats, sheet, month])
  return <>
    <PanelFrame title="打卡记录" covered={Boolean(sheet)} busy={periodEditing || started !== null || ['checkin','trip','leave','city'].includes(sheet ?? '')} footer={<PanelFooter updatedAt={updatedAt} status={started !== null ? '专注中' : undefined} refreshLabel="刷新打卡" onRefresh={started === null ? () => { void reload().catch(fail) } : undefined} actions={started !== null ? <button aria-label="结束心流" onClick={() => setStarted(null)}><Square size={24}/><span>结束心流</span></button> : <button aria-label="心流模式" disabled={periodEditing} onClick={() => { setStarted(Date.now()); setNow(Date.now()) }}><Scan size={24}/><span>进入心流</span></button>}/> }>
      <div className="desktop-checkin" data-testid="desktop-widget" data-mode={started ? 'focus' : 'normal'} inert={Boolean(sheet)} aria-hidden={Boolean(sheet)}>
        <div className="desktop-clock-row"><time>{new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
          <button onClick={() => setSheet('city')} aria-label="设置天气城市"><CloudSun size={17}/>{snapshot?.preferences.city?.name ?? '选择城市'}{weather?.weather && <span>{Math.round(weather.weather.temperature)}°</span>}</button></div>
        <section className="desktop-water-reminder" aria-label="喝水提醒" data-due={waterSeconds === 0}>
          <Drop size={20} aria-hidden="true"/><h2>喝水提醒</h2>
          <div className="water-reminder-status" role="status">
            {waterSeconds === null ? '每 30 分钟' : waterSeconds === 0 ? '该喝水了' :
              <span role="timer" aria-live="off" aria-label="下次喝水提醒倒计时">{[Math.floor(waterSeconds / 60), waterSeconds % 60].map(n => String(n).padStart(2, '0')).join(':')}</span>}
          </div>
          <button className="water-reminder-action" disabled={!snapshot || waterBusy} onClick={() => { void updateWater('restart') }}>
            {waterDueAt === null ? '开启' : '已喝'}
          </button>
          {waterDueAt !== null && <button className="water-reminder-stop" aria-label="关闭喝水提醒" title="关闭喝水提醒" disabled={waterBusy} onClick={() => { void updateWater('stop') }}><BellSlash size={18}/></button>}
        </section>
        {waterError && <p className="water-reminder-error" role="alert">{waterError}</p>}
        {started === null && <div className="desktop-checkin-actions"><button className="widget-tone-info" onClick={() => setSheet('trip')}><BriefcaseBusiness size={16}/>出差</button><button className="widget-tone-caution" onClick={() => setSheet('leave')}><Coffee size={16}/>休假</button><button className="widget-tone-neutral" aria-label="面板设置" onClick={() => setSheet('settings')}><Settings2 size={16}/>设置</button></div>}
        {started !== null ? <section className="desktop-focus">
          <span>正在专注</span><output aria-label="心流持续时间">{focusElapsed(started, now)}</output>
          <input ref={focusInput} aria-label="专注事项" placeholder="专注事项" value={focusText} maxLength={80} onChange={e => setFocusText(e.target.value)} onBlur={() => { if (focusText !== snapshot?.preferences.focusText) void update({ focusText }).catch(fail) }} />
        </section> : <>
          <button className="desktop-today" aria-label="填写打卡起止时间" disabled={!stats} onClick={() => showDay()}>
            <span>今日研究{stats?.today.absence && <span>{checkinAbsenceLabels[stats.today.absence.kind]}</span>}</span>
            <strong>{stats ? widgetDuration(stats.today.minutes) : '—'}</strong><ChevronRight size={18}/></button>
          {active && <button className="widget-active-checkin" onClick={() => showDay(active.date, active)}><span>{active.date === today ? '' : `${active.date} · `}{active.startTime} 开始</span><strong>结束打卡</strong><ChevronRight size={16}/></button>}
          <div className="desktop-progress-grid">{(['week','month'] as const).map(period => <button key={period} className={`period-ring period-${period}`} onClick={() => { setSheet(period); setParent(null) }} aria-label={period === 'week' ? '查看本周打卡' : '查看本月打卡'}>
            <span>{period === 'week' ? '本周' : '本月'}<ChevronRight size={16}/></span>
            <ProgressRing value={stats?.[period].percent ?? null} label={period === 'week' ? '本周研究进度' : '本月研究进度'}/>
            <span className="period-hours"><strong>{stats ? widgetHours(stats[period].minutes) : '—'}</strong> / {stats?.[period].target == null ? '—' : widgetHours(stats[period].target)} 小时</span>
          </button>)}</div>
          <AttendancePeriod report={report} preferences={snapshot?.preferences} save={update} editing={setPeriodEditing}/>
          <section className="desktop-today-records"><h2 className="desktop-group">今日时段 <span>{stats?.today.entries.length ?? 0}</span></h2>
            {!stats?.today.entries.length ? <button className="desktop-add-segment" onClick={() => showDay()}><PlusCircle size={24}/><span>添加时段</span></button> : <ul>{stats.today.entries.map(entry => <li key={entry.id}><span>{entry.startTime ? entry.endTime ? entry.startTime + ' — ' + entry.endTime + (entry.endsNextDay ? ' 次日' : '') : `${entry.startTime} 开始` : '未记录起止时间'}</span><span>{isOpenCheckin(entry) ? '打卡中' : widgetDuration(checkinDayParts(entry).find(p => p.date === stats?.today.date)?.minutes ?? 0)}</span></li>)}</ul>}
          </section>

        </>}
        {error && <button className="desktop-error" role="alert" onClick={() => { void reload().catch(fail) }}>{error}</button>}
      </div>
    </PanelFrame>
    {sheet && <WidgetSheet key={sheet} page={sheet} title={title} close={close} back={() => { setSheet(parent); setParent(null) }} backLabel={parent ? '返回打卡记录' : '返回桌面面板'}>
      {(sheet === 'week' || sheet === 'month') && report && stats && selected && <AttendancePanel key={sheet} snapshot={report} period={sheet} statistics={selected} today={stats.today.date} month={month} changeMonth={setMonth} scrollTop={scroll.current[sheet]} onScroll={value => { scroll.current[sheet] = value }} changePeriod={setSheet} editDay={showDay}/>}
      {sheet === 'checkin' && report && <CheckinPanel snapshot={report} reload={reload} initialDate={date} initialEntry={checkinEntry}/>}
      {(sheet === 'trip' || sheet === 'leave') && report && <AbsencePanel kind={sheet} snapshot={report} reload={reload}/>}
      {sheet === 'city' && <CityPanel selectedCityId={snapshot?.preferences.city?.id} choose={async city => { await update({ city }); close(); void window.workbench.widgetWeather().then(unwrap).then(setWeather).catch(fail) }}/>}
      {sheet === 'settings' && snapshot && <PreferencesPanel snapshot={snapshot} update={update} openCity={() => { setParent('settings'); setSheet('city') }}/>}
    </WidgetSheet>}
  </>
}
