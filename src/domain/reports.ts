import { z } from 'zod'
import { isCalendarDate } from './validation'
import type { Paper, Project, Submission, Task } from '../shared/types'
import type { CheckinEntry, ReportSnapshot, StipendEntry } from '../shared/reports'
import { localDay } from '../shared/arxiv'

const day = z.string().refine(isCalendarDate, '请输入有效日期。')
const goal = z.number().int().min(0).max(100000)
const goals = z.object({ papers: goal, tasks: goal, submissions: goal, publications: goal, checkinMinutes: goal.default(0) }).strict()
export const reportSettingsSchema = z.object({ projectIds: z.array(z.string().uuid()).max(500), includeUnassigned: z.boolean(),
  projectsConfigured: z.boolean(), goals: z.object({ week: goals, month: goals }).strict() }).strict()
export const stipendInputSchema = z.object({ receivedOn: day, amountCents: z.number().int().min(1).max(10000000000),
  source: z.string().trim().min(1, '请填写津贴来源。').max(120), notes: z.string().max(1000) }).strict()
export const stipendListSchema = z.array(stipendInputSchema.extend({ id: z.string().uuid(), createdAt: z.iso.datetime() })).max(10000)
export const readingDatesSchema = z.record(z.string().uuid(), day)
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '请填写有效的开始和结束时间。')
export function checkinDuration(start: string, end: string, nextDay = false): number {
  if (!time.safeParse(start).success || !time.safeParse(end).success) return 0
  const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
  const duration = minute(end) - minute(start) + (nextDay ? 1440 : 0)
  return duration > 0 && duration <= 1440 ? duration : 0
}
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60), remainder = minutes % 60
  return hours ? `${hours} 小时${remainder ? ` ${remainder} 分钟` : ''}` : `${remainder} 分钟`
}
export const checkinInputSchema = z.object({ date: day, startTime: time, endTime: time, endsNextDay: z.boolean().default(false), notes: z.string().max(1000) }).strict()
  .refine(item => checkinDuration(item.startTime, item.endTime, item.endsNextDay) > 0, { message: '结束时间须晚于开始时间，且时长不能超过 24 小时；跨午夜请勾选“结束于次日”。', path: ['endTime'] })
// Existing duration-only records remain readable; no start time is invented for them.
export const checkinListSchema = z.array(z.object({ date: day, durationMinutes: z.number().int().min(1).max(1440), notes: z.string().max(1000),
  startTime: time.optional(), endTime: time.optional(), endsNextDay: z.boolean().optional(), id: z.string().uuid(), createdAt: z.iso.datetime() }).strict()
  .refine(item => (!item.startTime && !item.endTime && !item.endsNextDay) || (!!item.startTime && !!item.endTime && checkinDuration(item.startTime, item.endTime, item.endsNextDay) === item.durationMinutes), '打卡时间段与时长不一致，原记录已保留。')).max(10000)
export function checkinDayParts(item: CheckinEntry): { date: string; minutes: number }[] {
  if (!item.endsNextDay || !item.startTime) return [{ date: item.date, minutes: item.durationMinutes }]
  const first = 1440 - Number(item.startTime.slice(0, 2)) * 60 - Number(item.startTime.slice(3))
  const next = new Date(`${item.date}T12:00:00`); next.setDate(next.getDate() + 1)
  return [{ date: item.date, minutes: first }, { date: localDay(next), minutes: item.durationMinutes - first }].filter(part => part.minutes > 0)
}
export function stipendYear(entries: StipendEntry[], year: number) {
  const receipts = entries.filter(item => item.receivedOn.startsWith(`${year}-`))
  const months = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, '0')}`
    return { label: `${index + 1}月`, title: `${year}年${index + 1}月`, amountCents: receipts.filter(item => item.receivedOn.startsWith(key)).reduce((sum, item) => sum + item.amountCents, 0) }
  })
  return { months, receipts, amountCents: receipts.reduce((sum, item) => sum + item.amountCents, 0) }
}
export const readingDateInputSchema = z.object({ paperId: z.string().uuid(), date: day }).strict()
export type ReportPeriod = 'week' | 'month' | 'custom'
export interface DateRange { start: string; end: string }
export interface ReportSelection { period: 'week' | 'month'; month: string; week: number }
export function monthWeeks(month: string) {
  if (!isCalendarDate(`${month}-01`)) return []
  const last = new Date(`${month}-01T12:00:00`); last.setMonth(last.getMonth() + 1, 0)
  const names = ['第一周', '第二周', '第三周', '第四周', '第五周']
  return Array.from({ length: Math.ceil(last.getDate() / 7) }, (_, index) => {
    const first = index * 7 + 1, end = Math.min(first + 6, last.getDate()), m = last.getMonth() + 1
    return { start: `${month}-${String(first).padStart(2, '0')}`, end: `${month}-${String(end).padStart(2, '0')}`,
      label: `${m}月${names[index]}（${m}.${first}–${m}.${end}）` }
  })
}
export function selectionRange(selection: ReportSelection): DateRange {
  const weeks = monthWeeks(selection.month)
  if (!weeks.length) return reportRange('month', new Date())
  return selection.period === 'week' ? weeks[Math.max(0, Math.min(selection.week, weeks.length - 1))]!
    : { start: weeks[0]!.start, end: weeks[weeks.length - 1]!.end }
}
export function rangeDays(range: DateRange): string[] {
  const days: string[] = [], date = new Date(`${range.start}T12:00:00`)
  for (let i = 0; i < 366 && localDay(date) <= range.end; i++, date.setDate(date.getDate() + 1)) days.push(localDay(date))
  return days
}
export function reportRange(period: Exclude<ReportPeriod, 'custom'>, anchor: Date): DateRange {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()), end = new Date(start)
  if (period === 'week') { start.setDate(start.getDate() - (start.getDay() + 6) % 7); end.setTime(start.getTime()); end.setDate(end.getDate() + 6) }
  else { start.setDate(1); end.setMonth(end.getMonth() + 1, 0) }
  return { start: localDay(start), end: localDay(end) }
}
const inside = (day: string | null | undefined, range: DateRange) => !!day && isCalendarDate(day) && day >= range.start && day <= range.end
const timestampDay = (value: string | null) => value && Number.isFinite(new Date(value).getTime()) ? localDay(new Date(value)) : null
const preparation = /准备|未投稿|待投稿|待提交|计划|draft|prepar/i
// A submission record is one journal round; preparation stages do not create a submission.
export const firstSubmittedDay = (submission: Submission) => [...submission.stages]
  .filter(stage => !preparation.test(stage.name)).sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))[0]?.occurredOn ?? null
export function reportData(snapshot: ReportSnapshot, tasks: Task[], papers: Paper[], submissions: Submission[], projects: Project[], range: DateRange) {
  const selected = new Set(snapshot.settings.projectIds)
  const researchTasks = tasks.filter(task => !snapshot.settings.projectsConfigured || (task.projectId ? selected.has(task.projectId) : snapshot.settings.includeUnassigned))
  const completed = researchTasks.filter(task => task.status === 'completed' && inside(timestampDay(task.completedAt), range))
  const literature = papers.filter(paper => paper.collection !== 'publication')
  const read = literature.filter(paper => paper.readingStatus === 'done' && inside(snapshot.readingDates[paper.id], range))
  const rounds = submissions.filter(submission => inside(firstSubmittedDay(submission), range))
  const submitted = new Set(rounds.map(submission => submission.manuscriptGroupId || submission.id)).size
  const published = papers.filter(paper => paper.collection === 'publication' && inside(paper.publishedDate, range))
  const receipts = snapshot.stipends.filter(item => inside(item.receivedOn, range))
  const checkins = snapshot.checkins.filter(item => checkinDayParts(item).some(part => inside(part.date, range)))
  const checkinParts = checkins.flatMap(checkinDayParts).filter(part => inside(part.date, range))
  const bucketCount = Math.round((new Date(`${range.end}T12:00:00`).getTime() - new Date(`${range.start}T12:00:00`).getTime()) / 86400000) + 1
  const bucketSize = bucketCount <= 7 ? 1 : bucketCount <= 35 ? 7 : Math.ceil(bucketCount / 12)
  const buckets: { start: string; end: string; label: string; papers: number; tasks: number; stipendCents: number; checkinMinutes: number }[] = []
  for (let i = 0; i < bucketCount; i += bucketSize) {
    const from = new Date(`${range.start}T12:00:00`), through = new Date(from)
    from.setDate(from.getDate() + i); through.setDate(through.getDate() + Math.min(i + bucketSize - 1, bucketCount - 1))
    const part = { start: localDay(from), end: localDay(through) }
    buckets.push({ ...part, label: `${from.getMonth() + 1}/${from.getDate()}`, papers: read.filter(p => inside(snapshot.readingDates[p.id], part)).length,
      tasks: completed.filter(task => inside(timestampDay(task.completedAt), part)).length,
      stipendCents: receipts.filter(item => inside(item.receivedOn, part)).reduce((sum, item) => sum + item.amountCents, 0),
      checkinMinutes: checkinParts.filter(item => inside(item.date, part)).reduce((sum, item) => sum + item.minutes, 0) })
  }
  const days = rangeDays(range).map(date => ({
    date, papers: read.filter(paper => snapshot.readingDates[paper.id] === date).length,
    tasks: completed.filter(task => timestampDay(task.completedAt) === date).length,
    checkinMinutes: checkinParts.filter(part => part.date === date).reduce((sum, part) => sum + part.minutes, 0)
  }))
  return { read, completed, rounds, submitted, published, receipts, buckets, days, checkins,
    checkinMinutes: checkinParts.reduce((sum, item) => sum + item.minutes, 0), checkinDays: new Set(checkinParts.map(item => item.date)).size,
    amountCents: receipts.reduce((sum, item) => sum + item.amountCents, 0),
    missingReading: literature.filter(paper => paper.readingStatus === 'done' && !snapshot.readingDates[paper.id]),
    allRead: literature.filter(paper => paper.readingStatus === 'done').length,
    annotated: literature.filter(paper => paper.notes.trim() || paper.excerpts.length || paper.highlights.length).length,
    excerpts: literature.flatMap(paper => paper.excerpts).filter(item => inside(timestampDay(item.createdAt), range)).length,
    missingPublicationDates: papers.filter(paper => paper.collection === 'publication' && !isCalendarDate(paper.publishedDate)).length,
    missingTaskDates: researchTasks.filter(task => task.status === 'completed' && !timestampDay(task.completedAt)).length,
    projectBreakdown: [...projects.map(project => ({ id: project.id, title: project.name })), { id: '', title: '未分配项目' }]
      .map(project => ({ ...project, completed: completed.filter(task => (task.projectId ?? '') === project.id).length }))
      .filter(project => project.completed > 0) }
}
