import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { WorkbenchDatabase } from '../db'
import { appSettings } from '../schema'
import { DomainError } from '../../../domain/errors'
import { defaultReportSettings, type ReportSettings, type ReportSnapshot, type StipendInput, type CheckinInput } from '../../../shared/reports'
import { readingDateInputSchema, readingDatesSchema, reportSettingsSchema, stipendInputSchema, stipendListSchema, checkinInputSchema, checkinListSchema, checkinDuration, checkinDayParts } from '../../../domain/reports'
import { LibraryRepository } from './library'

export const readingDatesKey = 'research.reading-dates.v1'
export class ReportsRepository {
  constructor(private readonly db: WorkbenchDatabase) {}
  private read(key: string): unknown {
    const row = this.db.select().from(appSettings).where(eq(appSettings.key, key)).get()
    if (!row) return undefined
    try { return JSON.parse(row.value) as unknown }
    catch { throw new DomainError('VALIDATION', '报表记录格式无效，原记录已保留。') }
  }
  private write(key: string, input: unknown) {
    const value = JSON.stringify(input)
    this.db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } }).run()
  }
  snapshot(): ReportSnapshot {
    try { return { settings: reportSettingsSchema.parse(this.read('research.settings.v1') ?? structuredClone(defaultReportSettings)),
      stipends: stipendListSchema.parse(this.read('research.stipends.v1') ?? []), readingDates: readingDatesSchema.parse(this.read(readingDatesKey) ?? {}),
      checkins: checkinListSchema.parse(this.read('research.checkins.v1') ?? []) } }
    catch { throw new DomainError('VALIDATION', '报表记录无法读取，原记录已保留。') }
  }
  settings(input: ReportSettings) {
    this.snapshot()
    this.write('research.settings.v1', reportSettingsSchema.parse(input))
  }
  saveStipend(input: StipendInput, id?: string) {
    const parsed = stipendInputSchema.parse(input), entries = this.snapshot().stipends
    const previous = entries.find(item => item.id === id)
    if (id && !previous) throw new DomainError('NOT_FOUND', '此津贴记录已不存在。')
    const item = { ...parsed, id: previous?.id ?? randomUUID(), createdAt: previous?.createdAt ?? new Date().toISOString() }
    this.write('research.stipends.v1', stipendListSchema.parse(previous ? entries.map(old => old.id === id ? item : old) : [...entries, item]))
    return item
  }
  deleteStipend(id: string) { this.write('research.stipends.v1', this.snapshot().stipends.filter(item => item.id !== id)) }
  saveCheckin(input: CheckinInput, id?: string) {
    const parsed = checkinInputSchema.parse(input), entries = this.snapshot().checkins
    const previous = entries.find(item => item.id === id)
    if (id && !previous) throw new DomainError('NOT_FOUND', '此打卡记录已不存在。')
    const item = { ...parsed, durationMinutes: checkinDuration(parsed.startTime, parsed.endTime, parsed.endsNextDay), id: previous?.id ?? randomUUID(), createdAt: previous?.createdAt ?? new Date().toISOString() }
    const others = entries.filter(old => old.id !== id)
    for (const part of checkinDayParts(item)) {
      const recorded = others.flatMap(checkinDayParts).filter(old => old.date === part.date).reduce((sum, old) => sum + old.minutes, 0)
      if (recorded + part.minutes > 1440) throw new DomainError('VALIDATION', '同一天累计打卡时长不能超过 24 小时。')
    }
    const bounds = (entry: typeof item | (typeof entries)[number]) => {
      const start = new Date(`${entry.date}T${entry.startTime}:00`), end = new Date(`${entry.date}T${entry.endTime}:00`)
      if (entry.endsNextDay) end.setDate(end.getDate() + 1)
      return [start.getTime(), end.getTime()] as const
    }
    const [start, end] = bounds(item)
    if (others.some(old => {
      if (!old.startTime || !old.endTime) return false
      const [from, to] = bounds(old)
      return start < to && end > from
    })) throw new DomainError('VALIDATION', '这个时间段与已有打卡重叠，请修改时间或编辑原记录。')
    this.write('research.checkins.v1', checkinListSchema.parse(previous ? entries.map(old => old.id === id ? item : old) : [...entries, item]))
    return item
  }
  deleteCheckin(id: string) { this.write('research.checkins.v1', this.snapshot().checkins.filter(item => item.id !== id)) }
  readingDate(input: { paperId: string; date: string }) {
    const parsed = readingDateInputSchema.parse(input), paper = new LibraryRepository(this.db).paper(parsed.paperId)
    if (paper.collection === 'publication' || paper.readingStatus !== 'done') throw new DomainError('VALIDATION', '请先将文献标记为已读。')
    this.write(readingDatesKey, { ...this.snapshot().readingDates, [parsed.paperId]: parsed.date })
  }
}
