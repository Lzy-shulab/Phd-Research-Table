import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Plus, Settings2, Trash2, Pencil, Clock3, Activity, BookOpen, ListChecks } from 'lucide-react'
import { localDay } from '../../../shared/arxiv'
import { checkinAbsenceLabels, defaultReportSettings, type GoalMetric, type ReportSettings, type ReportSnapshot, type StipendEntry, type CheckinEntry, type CheckinAbsenceEntry, type CheckinAbsenceKind } from '../../../shared/reports'
import { reportData, reportSettingsSchema, checkinDuration, checkinDayParts, formatDuration, stipendYear, checkinAbsenceForDate } from '../../../domain/reports'
import { workdayTarget } from '../../../domain/work-calendar'
import type { Result } from '../../../shared/types'
import { useWorkbench } from '../../stores/workbench'
import { useLibrary } from '../../stores/library'
import { useTasks } from '../../hooks/use-tasks'
import { useClock } from '../../hooks/use-clock'
import { Button } from '../ui/button'
import { ConfirmDialog, Dialog } from '../ui/dialog'
import { ReportBars, ReportHeatmap } from './ReportCharts'
import { ReportPeriodPicker } from './ReportPeriodPicker'
import { useReportPeriod } from '../../hooks/use-report-period'
import { ReportGoalCard } from './ReportGoalCard'
import { ReportDayDetails } from './ReportDayDetails'
import { CheckinAbsenceForm } from './CheckinAbsenceForm'

const money = (cents: number) => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
type VisibleMetric = Extract<GoalMetric, 'tasks' | 'papers' | 'checkinMinutes'>
const labels: Record<VisibleMetric, string> = { tasks: '完成任务', papers: '读完论文', checkinMinutes: '打卡时长' }
const units: Record<VisibleMetric, string> = { tasks: '项', papers: '篇', checkinMinutes: '小时' }
const metrics: VisibleMetric[] = ['tasks', 'papers', 'checkinMinutes']
export function ReportsWorkspace() {
  const projects = useWorkbench(state => state.projects)
  const tasks = useTasks(), papers = useLibrary(state => state.papers)
  const now = useClock()
  const [snapshot, setSnapshot] = useState<ReportSnapshot>({ settings: structuredClone(defaultReportSettings), stipends: [], readingDates: {}, checkins: [], absences: [] })
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const activityPeriod = useReportPeriod(), checkinPeriod = useReportPeriod()
  const [activityMetric, setActivityMetric] = useState<'papers' | 'tasks'>('papers')
  const [financeYear, setFinanceYear] = useState(() => new Date().getFullYear())
  const [settingsOpen, setSettingsOpen] = useState(false), [settingsDraft, setSettingsDraft] = useState<ReportSettings>(() => structuredClone(defaultReportSettings))
  const [stipendOpen, setStipendOpen] = useState(false), [stipend, setStipend] = useState<StipendEntry | null>(null)
  const [stipendManagerOpen, setStipendManagerOpen] = useState(false)
  const [checkinOpen, setCheckinOpen] = useState(false), [checkin, setCheckin] = useState<CheckinEntry | null>(null)
  const [absenceKind, setAbsenceKind] = useState<CheckinAbsenceKind | null>(null), [absence, setAbsence] = useState<CheckinAbsenceEntry | null>(null)
  const [deleteItem, setDeleteItem] = useState<{ kind: 'stipend' | 'checkin' | 'absence'; id: string } | null>(null)
  const [activityDay, setActivityDay] = useState(''), [checkinDay, setCheckinDay] = useState('')
  const libraryError = useLibrary(state => state.loadError)
  const load = useCallback(async () => {
    try { const result = await window.workbench.researchReport(); if (!result.ok) { setError(result.error.message); return }; setSnapshot(result.data); setLoaded(true); setError('') }
    catch { setError('研究报表未能读取，请重试。') }
  }, [])
  useEffect(() => { void load(); window.addEventListener('focus', load); return () => window.removeEventListener('focus', load) }, [load, papers])
  const act = async (request: () => Promise<Result<unknown>>) => {
    if (busy) return false
    setBusy(true); setError('')
    try { const result = await request(); if (!result.ok) { setError(result.error.message); return false }; await load(); return true }
    catch { setError('记录未能保存，请重试。'); return false } finally { setBusy(false) }
  }
  const data = reportData(snapshot, tasks, papers, [], projects, activityPeriod.range)
  const checkinData = reportData(snapshot, tasks, papers, [], projects, checkinPeriod.range)
  const checkinTarget = workdayTarget(checkinPeriod.range, snapshot.absences)
  const periodAbsences = snapshot.absences.filter(item => item.startDate <= checkinPeriod.range.end && item.endDate >= checkinPeriod.range.start).sort((a, b) => a.startDate.localeCompare(b.startDate))
  const selectedActivity = data.days.some(day => day.date === activityDay) ? activityDay : [...data.days].reverse().find(day => day.papers || day.tasks)?.date ?? data.days.find(day => day.date === localDay(now))?.date ?? activityPeriod.range.start
  const selectedCheckin = checkinData.days.some(day => day.date === checkinDay) ? checkinDay : [...checkinData.days].reverse().find(day => day.checkinMinutes)?.date ?? checkinData.days.find(day => day.date === localDay(now))?.date ?? checkinPeriod.range.start
  const recordsForDay = (date: string) => checkinData.checkins.filter(entry => checkinDayParts(entry).some(part => part.date === date))
  const openAbsence = (kind: CheckinAbsenceKind, entry: CheckinAbsenceEntry | null = null) => { setAbsence(entry); setAbsenceKind(kind); setCheckinOpen(false); if (entry) document.getElementById('report-checkins')?.scrollIntoView({ block: 'start' }) }
  const finance = stipendYear(snapshot.stipends, financeYear)
  const openSettings = () => { setSettingsDraft(structuredClone(snapshot.settings.projectsConfigured ? snapshot.settings : { ...snapshot.settings, projectIds: projects.map(project => project.id), includeUnassigned: true })); setSettingsOpen(!settingsOpen) }
  return <main className="reports-workspace">
    <header className="workspace-header"><div><div className="workspace-breadcrumb">研究报表<span>/</span>周期回顾</div><div className="heading-line"><h1>研究报表</h1></div><p>回顾完成的任务、读完的论文与研究投入。</p></div><Button disabled={!loaded || busy} aria-expanded={settingsOpen} onClick={openSettings}><Settings2 size={16} />目标与项目</Button></header>
    <div className="workspace-body reports-body">
      {error && <div className="report-error" role="alert"><span>{error}</span>{!loaded && <Button onClick={() => void load()}>重新读取</Button>}</div>}
      {!loaded ? <p role="status">正在读取报表…</p> : <>
      <AnimatePresence initial={false}>{settingsOpen && <motion.form initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="report-settings report-panel" onSubmit={event => { event.preventDefault(); const parsed = reportSettingsSchema.safeParse({ ...settingsDraft, projectsConfigured: true }); if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查目标。'); return }; void act(() => window.workbench.saveReportSettings(parsed.data)).then(ok => { if (ok) setSettingsOpen(false) }) }}>
        <h2>目标与项目</h2><p>任务与阅读目标按周、月分别设置；填 0 表示暂不设置。打卡目标按官方工作日 × 12 小时计算，包含调休上班日，排除法定假期与普通周末；登记的出差和休假日期每天从周、月目标中扣除 12 小时，周末和节假日同样扣除。</p>
        <fieldset><legend>任务统计项目</legend><div className="report-project-options">{projects.map(project => <label key={project.id}><input type="checkbox" checked={settingsDraft.projectIds.includes(project.id)} onChange={event => setSettingsDraft({ ...settingsDraft, projectIds: event.target.checked ? [...settingsDraft.projectIds, project.id] : settingsDraft.projectIds.filter(id => id !== project.id) })} />{project.name}</label>)}<label><input type="checkbox" checked={settingsDraft.includeUnassigned} onChange={event => setSettingsDraft({ ...settingsDraft, includeUnassigned: event.target.checked })} />未分配项目的任务</label></div></fieldset>
        <div className="report-goal-inputs">{(['week', 'month'] as const).map(scope => <fieldset key={scope}><legend>{scope === 'week' ? '每周目标' : '每月目标'}</legend>{(['tasks', 'papers'] as const).map(metric => <label className="field" key={metric}>{labels[metric]}（{units[metric]}）<input type="number" min="0" max={100000} step={1} aria-label={`${scope === 'week' ? '每周' : '每月'}${labels[metric]}目标`} value={settingsDraft.goals[scope][metric]} onChange={event => setSettingsDraft({ ...settingsDraft, goals: { ...settingsDraft.goals, [scope]: { ...settingsDraft.goals[scope], [metric]: Number(event.target.value) } } })} /></label>)}</fieldset>)}</div>
        <div className="report-form-actions"><Button type="submit" variant="primary" disabled={busy}>保存目标与项目</Button><Button disabled={busy} onClick={() => setSettingsOpen(false)}>取消</Button></div>
      </motion.form>}</AnimatePresence>
      {libraryError && <div className="report-error" role="alert"><span>{libraryError}</span><Button onClick={() => void useLibrary.getState().load()}>重新读取文献</Button></div>}
      <section className="report-goals" id="report-goals" aria-label="周期目标进度">{metrics.map(metric => <ReportGoalCard key={metric} metric={metric} snapshot={snapshot} tasks={tasks} papers={papers} projects={projects} />)}</section>
      <section className="report-panel report-activity" id="report-trends">
        <header><div><h2><Activity size={18} />科研活动</h2><p>自动汇总文献阅读与研究计划，点击日期查看当天内容。</p></div><ReportPeriodPicker label="科研活动" selection={activityPeriod.selection} onChange={activityPeriod.setSelection} /></header>
        <div className={`report-activity-layout${!data.read.length && !data.completed.length ? ' is-empty-period' : ''}`}>
          <div className="report-activity-calendar">
            <div className="report-activity-heading"><div className="plan-layout-switch" role="group" aria-label="科研活动指标"><button aria-pressed={activityMetric === 'papers'} onClick={() => setActivityMetric('papers')}><BookOpen size={14} />阅读</button><button aria-pressed={activityMetric === 'tasks'} onClick={() => setActivityMetric('tasks')}><ListChecks size={14} />任务</button></div><span>读完 <b>{data.read.length}</b> 篇 · 完成 <b>{data.completed.length}</b> 项</span></div>
            <ReportHeatmap days={data.days} metric={activityMetric} label={activityMetric === 'papers' ? '读完论文' : '完成任务'} today={localDay(now)} selectedDate={selectedActivity} onSelectDate={setActivityDay} />

          </div>
          <aside className="report-side-detail" aria-label="科研活动当天详情">
            <ReportDayDetails date={selectedActivity} papers={data.read.filter(paper => snapshot.readingDates[paper.id] === selectedActivity)} tasks={data.completed.filter(task => task.completedAt && localDay(new Date(task.completedAt)) === selectedActivity)} />
          </aside>
        </div>
        {data.projectBreakdown.length > 0 && <div className="report-projects report-activity-projects"><h3>本期任务分布 <span>{data.completed.length} 项</span></h3><div className="report-project-bars">{data.projectBreakdown.map(project => <div key={project.id}><span>{project.title}</span><strong>{project.completed} 项 · {Math.round(project.completed / data.completed.length * 100)}%</strong><progress aria-label={project.title + '任务占比'} max={data.completed.length} value={project.completed} /></div>)}</div></div>}
        {data.missingReading.length > 0 && <p className="report-source-note">另有 {data.missingReading.length} 篇历史已读文献未记录完成日期，未纳入日期分布。此后标记已读会自动同步。</p>}
      </section>
      <section className="report-panel" id="report-checkins"><header><div><h2><Clock3 size={18} />研究打卡</h2><p>悬停查看时长，点击日期查看或维护当天打卡。</p></div><div className="report-panel-actions"><ReportPeriodPicker label="研究打卡" selection={checkinPeriod.selection} onChange={checkinPeriod.setSelection} /><div className="report-checkin-actions"><Button aria-expanded={absenceKind === 'trip'} onClick={() => openAbsence('trip')}><Plus size={15} />登记出差</Button><Button aria-expanded={absenceKind === 'leave'} onClick={() => openAbsence('leave')}><Plus size={15} />登记休假</Button><Button variant="primary" aria-expanded={checkinOpen} onClick={() => { setCheckin(null); setAbsenceKind(null); setCheckinOpen(!checkinOpen) }}><Plus size={15} />登记打卡</Button></div></div></header>
        <div className="report-checkin-totals"><div><span>所选期间累计</span><strong>{formatDuration(checkinData.checkinMinutes)}</strong></div><div><span>有打卡的日期</span><strong>{checkinData.checkinDays} <small>天</small></strong></div><div><span>本期目标 · 已扣除出差/休假</span><strong>{checkinTarget.known ? formatDuration(checkinTarget.minutes) : '节假日资料待补充'}</strong></div></div>
        <p className="report-absence-summary">出差和休假每天从周、月目标中扣除 12 小时，周末和节假日同样扣除；这些日期的打卡不计入累计。{checkinData.deductionMinutes > 0 && <strong> 本期扣除：出差 {checkinData.tripDays} 天、休假 {checkinData.leaveDays} 天，共 {formatDuration(checkinData.deductionMinutes)}。</strong>}</p>
        <AnimatePresence initial={false}>{absenceKind && <CheckinAbsenceForm key={absence?.id ?? absenceKind} entry={absence} kind={absenceKind} busy={busy} save={input => act(() => window.workbench.saveCheckinAbsence(input, absence?.id)).then(ok => { if (ok) { setAbsenceKind(null); setAbsence(null); setCheckinDay(input.startDate); checkinPeriod.setSelection({ period: 'month', month: input.startDate.slice(0, 7), week: 0 }) } })} cancel={() => setAbsenceKind(null)} />}</AnimatePresence>
        <AnimatePresence initial={false}>{checkinOpen && <CheckinForm key={checkin?.id ?? 'new'} entry={checkin} busy={busy} save={input => act(() => window.workbench.saveCheckin(input, checkin?.id)).then(ok => { if (ok) { setCheckinOpen(false); setCheckin(null) } })} cancel={() => setCheckinOpen(false)} />}</AnimatePresence>
        <div className={`report-activity-layout report-checkin-layout${!checkinData.checkinDays ? ' is-empty-period' : ''}`}>
          <ReportHeatmap days={checkinData.days} metric="checkinMinutes" label="研究打卡热力图" today={localDay(now)} selectedDate={selectedCheckin} onSelectDate={setCheckinDay} dayMark={date => { const item = checkinAbsenceForDate(snapshot.absences, date); return item ? { kind: item.kind, label: `${checkinAbsenceLabels[item.kind]} · 目标扣除 12 小时${item.notes ? ` · ${item.notes}` : ''}`, badge: item.kind === 'trip' ? '差' : '假' } : undefined }} details={date => recordsForDay(date).map(entry => [entry.startTime && entry.endTime ? (entry.date !== date ? '前日 ' : '') + entry.startTime + ' — ' + (entry.endsNextDay && entry.date === date ? '次日 ' : '') + entry.endTime : '原有时长记录', entry.notes].filter(Boolean).join(' · '))} />
          <aside className="report-side-detail" aria-label="研究打卡当天详情"><ReportDayDetails date={selectedCheckin} checkins={recordsForDay(selectedCheckin)} absence={checkinAbsenceForDate(snapshot.absences, selectedCheckin)} edit={entry => { setCheckin(entry); setAbsenceKind(null); setCheckinOpen(true) }} remove={id => setDeleteItem({ kind: 'checkin', id })} /><p className="report-source-note">在日历上选择一天，即可查看时间段与备注。</p></aside>
        </div>
        <div className="report-absence-records" aria-label="本期出差与休假记录"><h3>本期出差与休假 <span>{periodAbsences.length} 条记录</span></h3>{periodAbsences.length ? periodAbsences.map(item => <div className="report-absence-row" key={item.id}><div><strong>{checkinAbsenceLabels[item.kind]} <time dateTime={item.startDate}>{item.startDate}</time>{item.endDate !== item.startDate && <> — <time dateTime={item.endDate}>{item.endDate}</time></>}</strong>{item.notes && <span>{item.notes}</span>}</div><div className="report-row-actions"><Button variant="ghost" disabled={busy} aria-label={`编辑${checkinAbsenceLabels[item.kind]} ${item.startDate}`} onClick={() => openAbsence(item.kind, item)}><Pencil size={15} /></Button><Button variant="ghost" disabled={busy} aria-label={`移除${checkinAbsenceLabels[item.kind]} ${item.startDate}`} onClick={() => setDeleteItem({ kind: 'absence', id: item.id })}><Trash2 size={15} /></Button></div></div>) : <p className="report-empty">本期未登记出差或休假。</p>}</div>
      </section>
      <section className="report-panel" id="report-finance"><header><div><h2>津贴到账</h2><p>按到账月份汇总，悬停柱形查看金额与来源。</p></div><div className="report-finance-total"><span>{financeYear} 年合计<strong>¥ {money(finance.amountCents)}</strong></span><Button onClick={() => setStipendManagerOpen(true)}>管理记录</Button><Button variant="primary" aria-expanded={stipendOpen} onClick={() => { setStipend(null); setStipendOpen(!stipendOpen) }}><Plus size={15} />登记津贴</Button></div></header>
        <div className="report-finance-year"><Button variant="ghost" aria-label="上一年津贴" disabled={financeYear <= 1000} onClick={() => setFinanceYear(financeYear - 1)}><ChevronLeft size={17} /></Button><label>统计年份<select aria-label="津贴统计年份" value={financeYear} onChange={event => setFinanceYear(Number(event.target.value))}>{[...new Set([now.getFullYear(), financeYear, ...snapshot.stipends.map(item => Number(item.receivedOn.slice(0, 4)))])].sort((a, b) => b - a).map(year => <option key={year} value={year}>{year} 年</option>)}</select></label><Button variant="ghost" aria-label="下一年津贴" disabled={financeYear >= 9999} onClick={() => setFinanceYear(financeYear + 1)}><ChevronRight size={17} /></Button>{financeYear !== now.getFullYear() && <Button variant="ghost" onClick={() => setFinanceYear(now.getFullYear())}>回到今年</Button>}</div>
        <AnimatePresence initial={false}>{stipendOpen && <StipendForm key={stipend?.id ?? 'new'} entry={stipend} busy={busy} save={input => act(() => window.workbench.saveStipend(input, stipend?.id)).then(ok => { if (ok) { setFinanceYear(Number(input.receivedOn.slice(0, 4))); setStipendOpen(false); setStipend(null) } })} cancel={() => setStipendOpen(false)} />}</AnimatePresence>
        <div className="report-finance-chart"><ReportBars buckets={finance.months.map((month, index) => ({ label: month.label, title: month.title, values: [month.amountCents / 100],
          details: finance.receipts.filter(item => Number(item.receivedOn.slice(5, 7)) === index + 1).sort((a, b) => a.receivedOn.localeCompare(b.receivedOn)).map(item => `来源：${item.source} · ¥ ${money(item.amountCents)} · ${item.receivedOn.slice(5).replace('-', '.')}`)
        }))} series={['每月到账金额（元）']} format={value => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} /></div>
      </section>
      </>}
    </div>
    {stipendManagerOpen && <Dialog open onOpenChange={setStipendManagerOpen} title="管理津贴记录" description={`${financeYear} 年 · ${finance.receipts.length} 条记录`} className="report-record-dialog">
      {!finance.receipts.length ? <p className="report-empty">这一年还没有津贴记录。</p> : <div className="report-record-list">{[...finance.receipts].sort((a, b) => b.receivedOn.localeCompare(a.receivedOn)).map(item => <div key={item.id}><div><strong>{item.source}</strong><span>{item.receivedOn} · ¥ {money(item.amountCents)}{item.notes ? ` · ${item.notes}` : ''}</span></div><Button variant="ghost" aria-label={`编辑津贴 ${item.source}`} onClick={() => { setStipend(item); setStipendOpen(true); setStipendManagerOpen(false); document.getElementById('report-finance')?.scrollIntoView({ block: 'start' }) }}><Pencil size={15} /></Button><Button variant="ghost" aria-label={`移除津贴 ${item.source}`} onClick={() => { setStipendManagerOpen(false); setDeleteItem({ kind: 'stipend', id: item.id }) }}><Trash2 size={15} /></Button></div>)}</div>}
    </Dialog>}
    {deleteItem && <ConfirmDialog open title={deleteItem.kind === 'stipend' ? '移除这条津贴记录？' : deleteItem.kind === 'absence' ? '移除这条出差或休假记录？' : '移除这条打卡记录？'} description="移除后会重新计算报表中的金额或时长。" busy={busy} onClose={() => setDeleteItem(null)} onConfirm={() => void act(() => deleteItem.kind === 'stipend' ? window.workbench.deleteStipend(deleteItem.id) : deleteItem.kind === 'absence' ? window.workbench.deleteCheckinAbsence(deleteItem.id) : window.workbench.deleteCheckin(deleteItem.id)).then(ok => { if (ok) setDeleteItem(null) })} />}
  </main>
}
function StipendForm({ entry, busy, save, cancel }: { entry: StipendEntry | null; busy: boolean; save: (input: import('../../../shared/reports').StipendInput) => Promise<void>; cancel: () => void }) {
  const [date, setDate] = useState(entry?.receivedOn ?? localDay()), [amount, setAmount] = useState(entry ? String(entry.amountCents / 100) : ''), [source, setSource] = useState(entry?.source ?? ''), [notes, setNotes] = useState(entry?.notes ?? '')
  return <motion.form initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="report-entry-form" onSubmit={event => { event.preventDefault(); void save({ receivedOn: date, amountCents: Math.round(Number(amount) * 100), source: source.trim() || '津贴', notes }) }}>
    <label className="field">到账日期<input aria-label="津贴到账日期" type="date" value={date} required onChange={e => setDate(e.target.value)} /></label><label className="field">金额（元）<input aria-label="津贴金额" type="number" min="0.01" step="0.01" value={amount} required onChange={e => setAmount(e.target.value)} /></label><label className="field">来源（选填）<input aria-label="津贴来源" value={source} maxLength={120} placeholder="如助研津贴、奖学金" onChange={e => setSource(e.target.value)} /></label><label className="field">备注（选填）<input aria-label="津贴备注" value={notes} maxLength={1000} onChange={e => setNotes(e.target.value)} /></label><div className="report-form-actions"><Button type="submit" variant="primary" disabled={busy}>{entry ? '保存津贴修改' : '保存津贴'}</Button><Button disabled={busy} onClick={cancel}>取消</Button></div>
  </motion.form>
}
function CheckinForm({ entry, busy, save, cancel }: { entry: CheckinEntry | null; busy: boolean; save: (input: import('../../../shared/reports').CheckinInput) => Promise<void>; cancel: () => void }) {
  const [date, setDate] = useState(entry?.date ?? localDay()), [startTime, setStartTime] = useState(entry?.startTime ?? ''), [endTime, setEndTime] = useState(entry?.endTime ?? ''), [endsNextDay, setEndsNextDay] = useState(entry?.endsNextDay ?? false), [notes, setNotes] = useState(entry?.notes ?? '')
  const duration = checkinDuration(startTime, endTime, endsNextDay)
  return <motion.form initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="report-entry-form report-checkin-form" onSubmit={event => { event.preventDefault(); if (duration) void save({ date, startTime, endTime, endsNextDay, notes }) }}>
    {entry && !entry.startTime && <p className="report-entry-notice">这条旧记录保存了 {formatDuration(entry.durationMinutes)}，未登记时间段。请填写真实起止时间后保存。</p>}
    <label className="field">打卡日期<input aria-label="打卡日期" type="date" value={date} required onChange={e => setDate(e.target.value)} /></label><label className="field">开始时间<input aria-label="打卡开始时间" type="time" value={startTime} required onChange={e => setStartTime(e.target.value)} /></label><label className="field">结束时间<input aria-label="打卡结束时间" type="time" value={endTime} required aria-describedby="checkin-preview" onChange={e => setEndTime(e.target.value)} /></label><label className="field">备注（选填）<input aria-label="打卡备注" value={notes} maxLength={1000} placeholder="如实验、阅读或论文写作" onChange={e => setNotes(e.target.value)} /></label>
    <div className="report-time-preview"><label><input type="checkbox" checked={endsNextDay} onChange={event => setEndsNextDay(event.target.checked)} />结束于次日</label><output id="checkin-preview" aria-live="polite">{duration ? `研究时长：${formatDuration(duration)}` : startTime && endTime ? '请检查起止时间；跨午夜请勾选“结束于次日”。' : '填写起止时间后自动计算时长'}</output></div>
    <div className="report-form-actions"><Button type="submit" variant="primary" disabled={busy || !duration}>{entry ? '保存打卡修改' : '保存打卡'}</Button><Button disabled={busy} onClick={cancel}>取消</Button></div>
  </motion.form>
}
