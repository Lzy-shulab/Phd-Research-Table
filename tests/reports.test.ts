import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { openDatabase, type DatabaseConnection } from '../src/main/database/db'
import { ReportsRepository } from '../src/main/database/repositories/reports'
import { CountdownRepository } from '../src/main/database/repositories/countdowns'
import { LibraryRepository } from '../src/main/database/repositories/library'
import { TaskRepository } from '../src/main/database/repositories/tasks'
import { ProjectRepository } from '../src/main/database/repositories/projects'
import { SubmissionRepository } from '../src/main/database/repositories/submissions'
import { reportData, reportRange, stipendYear, formatDuration, monthWeeks, selectionRange } from '../src/domain/reports'
import { workdayTarget, researchWorkday, calendarDayMark } from '../src/domain/work-calendar'
import { countdownTime } from '../src/shared/countdowns'
import { paperMetadataDefaults } from '../src/shared/arxiv'
import type { Paper } from '../src/shared/types'
const connections: DatabaseConnection[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-15T04:00:00Z'))
})
describe('calendar reporting', () => {
  it('marks holidays before weekends, distinguishes make-up workdays, and leaves unknown years unlabelled', () => {
    expect(calendarDayMark('2026-09-25')).toMatchObject({ badge: '法', label: '中秋节假期' })
    expect(calendarDayMark('2026-09-27').badge).toBe('法')
    expect(calendarDayMark('2026-09-19').badge).toBe('休')
    expect(calendarDayMark('2026-09-20')).toMatchObject({ badge: '班', kind: 'work', label: '调休上班日' })
    expect(calendarDayMark('2027-09-19')).toMatchObject({ badge: '', kind: 'unknown' })
  })
  it('uses month-local seven-day windows, clips the final week and respects leap years', () => {
    expect(monthWeeks('2026-09').map(({ start, end }) => [start, end])).toEqual([
      ['2026-09-01', '2026-09-07'], ['2026-09-08', '2026-09-14'], ['2026-09-15', '2026-09-21'],
      ['2026-09-22', '2026-09-28'], ['2026-09-29', '2026-09-30']
    ])
    expect(monthWeeks('2026-09')[0]?.label).toBe('9月第一周（9.1–9.7）')
    expect(selectionRange({ period: 'week', month: '2026-09', week: 4 })).toMatchObject({ start: '2026-09-29', end: '2026-09-30' })
    expect(monthWeeks('2028-02')[4]?.end).toBe('2028-02-29')
    expect(monthWeeks('2026-02')).toHaveLength(4)
    expect(monthWeeks('2026-13')).toEqual([])
  })
  it('counts official workdays including make-up weekends and excludes holidays', () => {
    expect(workdayTarget({ start: '2026-09-01', end: '2026-09-30' })).toMatchObject({ known: true, days: 22, minutes: 15840 })
    expect(workdayTarget({ start: '2026-09-22', end: '2026-09-28' })).toMatchObject({ known: true, days: 4, minutes: 2880 })
    expect(researchWorkday('2026-09-20')).toBe(true)
    expect(researchWorkday('2026-09-19')).toBe(false)
    expect(researchWorkday('2026-10-10')).toBe(true)
    expect(workdayTarget({ start: '2026-09-15', end: '2026-09-21' })).toMatchObject({ known: true, days: 6, minutes: 4320 })
    expect(researchWorkday('2026-09-25')).toBe(false)
    expect(workdayTarget({ start: '2026-10-01', end: '2026-10-07' })).toMatchObject({ known: true, days: 0, minutes: 0 })
    expect(workdayTarget({ start: '2027-01-01', end: '2027-01-31' })).toMatchObject({ known: false, days: 0, minutes: 0 })
    expect(Math.round(645 / 15840 * 1000) / 10).toBe(4.1)
  })
})
function setup() {
  const connection = openDatabase(':memory:', resolve('src/main/database/migrations')); connections.push(connection)
  return { connection, reports: new ReportsRepository(connection.db), countdowns: new CountdownRepository(connection.db),
    library: new LibraryRepository(connection.db), tasks: new TaskRepository(connection.db), projects: new ProjectRepository(connection.db), submissions: new SubmissionRepository(connection.db) }
}
function paper(collection: Paper['collection'] = 'library'): Paper {
  return { ...paperMetadataDefaults, collection, id: randomUUID(), title: 'Synthetic reading', authors: 'Fixture', journal: 'Test', year: '2026', folderId: null, notes: '',
    originalName: 'fixture.pdf', sourcePath: '/fixture.pdf', translatedPath: null, sha256: randomUUID(), translationStatus: 'idle', translationError: '', pageCount: 2, readPage: 0, translatedReadPage: 0, lastReadAt: null, addedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}
afterEach(() => {
  for (const connection of connections.splice(0)) connection.close()
  vi.useRealTimers()
})
describe('Independent countdowns and research reporting', () => {
  it('deducts trip/leave dates from weekly and monthly targets while preserving manual records', () => {
    const { reports, connection } = setup()
    reports.saveCheckin({ date: '2026-09-07', startTime: '23:00', endTime: '01:00', endsNextDay: true, notes: '跨周打卡' })
    reports.saveCheckin({ date: '2026-09-09', startTime: '09:00', endTime: '11:00', endsNextDay: false, notes: '' })
    reports.saveCheckin({ date: '2026-09-14', startTime: '09:00', endTime: '10:00', endsNextDay: false, notes: '' })
    const original = connection.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('research.checkins.v1')
    const trip = reports.saveCheckinAbsence({ kind: 'trip', startDate: '2026-09-06', endDate: '2026-09-08', notes: '会议' })
    const leave = reports.saveCheckinAbsence({ kind: 'leave', startDate: '2026-09-14', endDate: '2026-09-14', notes: '年假' })
    const snapshot = new ReportsRepository(connection.db).snapshot()
    expect(snapshot.absences).toEqual([trip, leave])
    const month = { start: '2026-09-01', end: '2026-09-30' }
    expect(workdayTarget(month, snapshot.absences)).toMatchObject({ days: 22, minutes: 216 * 60, deductionMinutes: 48 * 60 })
    const firstWeek = selectionRange({ month: '2026-09', period: 'week', week: 0 })
    expect(workdayTarget(firstWeek, snapshot.absences)).toMatchObject({ days: 5, minutes: 36 * 60 })
    const secondWeek = selectionRange({ month: '2026-09', period: 'week', week: 1 })
    expect(workdayTarget(secondWeek, snapshot.absences)).toMatchObject({ days: 5, minutes: 36 * 60 })
    const data = reportData(snapshot, [], [], [], [], month)
    expect(data).toMatchObject({ checkinMinutes: 2 * 60, checkinDays: 1, deductionMinutes: 48 * 60, tripDays: 3, leaveDays: 1 })
    expect(data.days.find(day => day.date === '2026-09-06')?.checkinMinutes).toBe(0)
    expect(data.days.find(day => day.date === '2026-09-08')?.checkinMinutes).toBe(0)
    expect(data.buckets.reduce((sum, bucket) => sum + bucket.checkinMinutes, 0)).toBe(2 * 60)
    expect(reportData(snapshot, [], [], [], [], firstWeek).checkinMinutes).toBe(0)
    expect(reportData(snapshot, [], [], [], [], secondWeek).checkinMinutes).toBe(2 * 60)
    reports.saveCheckinAbsence({ kind: 'leave', startDate: '2026-09-15', endDate: '2026-09-15', notes: '改期' }, leave.id)
    expect(reportData(reports.snapshot(), [], [], [], [], secondWeek).checkinMinutes).toBe(3 * 60)
    reports.deleteCheckinAbsence(trip.id)
    expect(reportData(reports.snapshot(), [], [], [], [], month).checkinMinutes).toBe(5 * 60)
    expect(connection.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('research.checkins.v1')).toEqual(original)
  })
  it('clips cross-month absences and overnight check-ins to each calendar period', () => {
    const { reports } = setup()
    reports.saveCheckin({ date: '2026-09-30', startTime: '23:00', endTime: '01:00', endsNextDay: true, notes: '' })
    const trip = reports.saveCheckinAbsence({ kind: 'trip', startDate: '2026-09-30', endDate: '2026-10-02', notes: '' })
    const snapshot = reports.snapshot(), september = { start: '2026-09-01', end: '2026-09-30' }, october = { start: '2026-10-01', end: '2026-10-31' }
    expect(workdayTarget(september, snapshot.absences)).toMatchObject({ minutes: 252 * 60 })
    expect(workdayTarget(october, snapshot.absences)).toMatchObject({ minutes: 192 * 60 })
    expect(reportData(snapshot, [], [], [], [], september)).toMatchObject({ checkinMinutes: 0, deductionMinutes: 720, checkinDays: 0 })
    expect(reportData(snapshot, [], [], [], [], october)).toMatchObject({ checkinMinutes: 0, deductionMinutes: 1440, checkinDays: 0 })
    reports.deleteCheckinAbsence(trip.id)
    expect(reportData(reports.snapshot(), [], [], [], [], september).checkinMinutes).toBe(60)
    expect(reportData(reports.snapshot(), [], [], [], [], october).checkinMinutes).toBe(60)
  })
  it('deducts twelve hours for each weekend leave date without creating check-ins', () => {
    const { reports } = setup()
    reports.saveCheckinAbsence({ kind: 'leave', startDate: '2026-09-12', endDate: '2026-09-13', notes: '' })
    const range = { start: '2026-09-08', end: '2026-09-14' }
    const data = reportData(reports.snapshot(), [], [], [], [], range)
    expect(data).toMatchObject({ checkinMinutes: 0, deductionMinutes: 1440, checkinDays: 0, leaveDays: 2 })
    expect(data.checkins).toEqual([])
    expect(data.days.filter(day => day.checkinMinutes)).toEqual([])
    expect(workdayTarget(range, reports.snapshot().absences)).toMatchObject({ days: 5, minutes: 2160 })
  })
  it('rejects overlapping or reversed absence dates and allows correction without touching other records', () => {
    const { reports, connection } = setup()
    connection.sqlite.prepare('INSERT INTO app_settings(key,value) VALUES(?,?)').run('absence-test.unrelated', 'keep')
    const trip = reports.saveCheckinAbsence({ kind: 'trip', startDate: '2026-09-20', endDate: '2026-09-21', notes: '' })
    expect(() => reports.saveCheckinAbsence({ kind: 'leave', startDate: '2026-09-21', endDate: '2026-09-22', notes: '' })).toThrow('已有出差或休假')
    expect(() => reports.saveCheckinAbsence({ kind: 'leave', startDate: '2026-09-22', endDate: '2026-09-21', notes: '' })).toThrow('结束日期')
    reports.saveCheckinAbsence({ kind: 'leave', startDate: '2026-09-20', endDate: '2026-09-20', notes: '改为休假' }, trip.id)
    expect(reportData(reports.snapshot(), [], [], [], [], { start: '2026-09-15', end: '2026-09-21' })).toMatchObject({ checkinMinutes: 0, deductionMinutes: 720, leaveDays: 1, tripDays: 0 })
    reports.deleteCheckinAbsence(trip.id)
    expect(reports.snapshot().absences).toEqual([])
    expect(connection.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('absence-test.unrelated')).toEqual({ value: 'keep' })
  })
  it('expires at the exact instant, persists cleanup, and retains unrelated settings and tasks', () => {
    const { countdowns, connection, tasks, projects } = setup()
    const deadline = new Date(Date.now() + 60_000).toISOString()
    const later = new Date(Date.now() + 120_000).toISOString()
    const first = countdowns.save({ title: '即将结束', deadline })
    const second = countdowns.save({ title: '继续保留', deadline: later })
    const project = projects.create({ name: '保留项目', colorKey: 'sage', description: '' })
    const task = tasks.create({ title: '任务保留', projectId: project.id })
    connection.sqlite.prepare('INSERT INTO app_settings(key,value) VALUES(?,?)').run('expiry-test.unrelated', 'keep')
    expect(countdowns.list(new Date(new Date(deadline).getTime() - 1))).toHaveLength(2)
    expect(countdowns.list(new Date(deadline))).toEqual([second])
    const reopened = new CountdownRepository(connection.db)
    expect(reopened.list()).toEqual([second])
    expect(tasks.list().map(item => item.id)).toContain(task.id)
    expect(connection.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('expiry-test.unrelated')).toEqual({ value: 'keep' })
    expect(connection.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('planner.countdowns.v1')).toEqual({ value: JSON.stringify([second]) })
    expect(() => countdowns.save({ title: first.title, deadline: new Date(Date.now() - 1).toISOString() })).toThrow('尚未到达')
  })
  it('retains malformed saved countdowns instead of clearing the setting', () => {
    const { countdowns, connection } = setup()
    connection.sqlite.prepare('INSERT INTO app_settings(key,value) VALUES(?,?)').run('planner.countdowns.v1', 'invalid-saved-value')
    expect(() => countdowns.list()).toThrow('原记录已保留')
    expect(connection.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('planner.countdowns.v1')).toEqual({ value: 'invalid-saved-value' })
  })
  it('persists independent countdowns without creating tasks, validates dates and clamps expired rings', () => {
    const { countdowns, tasks } = setup()
    const item = countdowns.save({ title: '实验验收', deadline: '2026-10-01T09:30:00+08:00' })
    expect(countdowns.list()).toHaveLength(1); expect(tasks.list()).toHaveLength(0)
    const changed = countdowns.save({ title: '材料实验验收', deadline: '2026-10-02T09:30:00+08:00' }, item.id)
    expect(changed.createdAt).toBe(item.createdAt)
    expect(countdownTime({ ...item, createdAt: '2026-09-01T00:00:00Z' }, new Date('2026-10-01T01:00:00Z'))).toMatchObject({ days: 0, hours: 0, minutes: 30, expired: false })
    expect(countdownTime(item, new Date('2026-10-03T00:00:00Z'))).toMatchObject({ ratio: 0, expired: true })
    expect(() => countdowns.save({ title: 'bad', deadline: 'invalid' })).toThrow()
    countdowns.remove(item.id); expect(countdowns.list()).toEqual([])
  })
  it('records first reading completion once, supports historical corrections and never assigns dates to old done records', () => {
    const { library, reports } = setup()
    const old = library.insert({ ...paper(), readingStatus: 'done' }), current = library.insert(paper())
    library.updatePaper(current.id, { readingStatus: 'done' })
    const first = reports.snapshot().readingDates[current.id]
    expect(first).toBeTruthy(); expect(reports.snapshot().readingDates[old.id]).toBeUndefined()
    reports.readingDate({ paperId: current.id, date: '2026-08-25' })
    library.updatePaper(current.id, { notes: 'Updated notes', readingStatus: 'done' })
    expect(reports.snapshot().readingDates[current.id]).toBe('2026-08-25')
    reports.readingDate({ paperId: old.id, date: '2026-09-03' })
    expect(() => reports.readingDate({ paperId: old.id, date: '2026-02-30' })).toThrow()
  })
  it('totals cash precisely and checks daily check-in limits across edits', () => {
    const { reports } = setup()
    reports.saveStipend({ receivedOn: '2026-09-02', amountCents: 10, source: '助研', notes: '' })
    reports.saveStipend({ receivedOn: '2026-09-10', amountCents: 20, source: '助研', notes: '' })
    const first = reports.saveCheckin({ date: '2026-09-02', startTime: '09:00', endTime: '10:30', endsNextDay: false, notes: '阅读' })
    const second = reports.saveCheckin({ date: '2026-09-02', startTime: '11:00', endTime: '12:00', endsNextDay: false, notes: '写作' })
    reports.saveCheckin({ date: '2026-09-02', startTime: '09:00', endTime: '11:00', endsNextDay: false, notes: '修正' }, first.id)
    expect(() => reports.saveCheckin({ date: '2026-09-02', startTime: '00:00', endTime: '23:59', endsNextDay: false, notes: '' })).toThrow('24 小时')
    const data = reportData(reports.snapshot(), [], [], [], [], { start: '2026-09-01', end: '2026-09-30' })
    expect(data.amountCents).toBe(30); expect(data.checkinMinutes).toBe(180); expect(data.checkinDays).toBe(1)
    reports.deleteCheckin(second.id); expect(reports.snapshot().checkins).toHaveLength(1)
  })
  it('derives interval minutes, rejects overlapping and reversed times, and splits midnight at report boundaries', () => {
    const { reports } = setup()
    const overnight = reports.saveCheckin({ date: '2026-09-30', startTime: '23:30', endTime: '01:15', endsNextDay: true, notes: '跨月实验' })
    expect(overnight.durationMinutes).toBe(105)
    expect(() => reports.saveCheckin({ date: '2026-10-01', startTime: '00:30', endTime: '02:00', endsNextDay: false, notes: '' })).toThrow('重叠')
    expect(() => reports.saveCheckin({ date: '2026-09-30', startTime: '20:00', endTime: '19:00', endsNextDay: false, notes: '' })).toThrow('结束时间')
    expect(() => reports.saveCheckin({ date: '2026-09-30', startTime: '20:00', endTime: '21:00', endsNextDay: true, notes: '' })).toThrow('24 小时')
    const september = reportData(reports.snapshot(), [], [], [], [], { start: '2026-09-01', end: '2026-09-30' })
    const october = reportData(reports.snapshot(), [], [], [], [], { start: '2026-10-01', end: '2026-10-31' })
    expect(september.checkinMinutes).toBe(30); expect(october.checkinMinutes).toBe(75)
    expect(september.days.find(day => day.date === '2026-09-30')?.checkinMinutes).toBe(30)
    expect(october.days.find(day => day.date === '2026-10-01')?.checkinMinutes).toBe(75)
    expect(october.checkinDays).toBe(1); expect(october.checkins).toHaveLength(1)
    expect(october.buckets.reduce((sum, bucket) => sum + bucket.checkinMinutes, 0)).toBe(75)
    const minute = reports.saveCheckin({ date: '2026-10-01', startTime: '01:15', endTime: '01:16', endsNextDay: false, notes: '' })
    expect(formatDuration(minute.durationMinutes)).toBe('1 分钟')
  })
  it('retains legacy duration records without inventing times and aggregates exactly twelve receipt months', () => {
    const { reports, connection } = setup()
    const old = { id: randomUUID(), date: '2026-09-02', durationMinutes: 90, notes: '旧记录', createdAt: new Date().toISOString() }
    connection.sqlite.prepare('INSERT INTO app_settings(key,value) VALUES(?,?)').run('research.checkins.v1', JSON.stringify([old]))
    expect(reports.snapshot().checkins[0]).toEqual(old)
    reports.saveCheckin({ date: '2026-09-03', startTime: '09:00', endTime: '10:00', endsNextDay: false, notes: '' })
    expect(reports.snapshot().checkins.find(item => item.id === old.id)).toEqual(old)
    for (const [receivedOn, amountCents] of [['2026-09-02', 10], ['2026-09-30', 20], ['2026-12-31', 40], ['2027-01-01', 80]] as const) reports.saveStipend({ receivedOn, amountCents, source: '补发津贴', notes: '' })
    const annual = stipendYear(reports.snapshot().stipends, 2026)
    expect(annual.months).toHaveLength(12); expect(annual.months[0]?.amountCents).toBe(0)
    expect(annual.months[8]?.amountCents).toBe(30); expect(annual.months[11]?.amountCents).toBe(40)
    expect(annual.amountCents).toBe(70); expect(annual.months.reduce((sum, month) => sum + month.amountCents, 0)).toBe(70)
    expect(stipendYear(reports.snapshot().stipends, 2027).amountCents).toBe(80)
  })
  it('filters research projects, deduplicates journal rounds and uses exact local boundaries', () => {
    const { reports, projects, tasks, library, submissions } = setup()
    const research = projects.create({ name: '实验', colorKey: 'sage', description: '' }), personal = projects.create({ name: '家教', colorKey: 'blue', description: '' })
    for (const project of [research, personal]) { const task = tasks.create({ title: project.name, projectId: project.id }); tasks.complete(task.id, true) }
    expect(reportData(reports.snapshot(), tasks.list(), [], [], projects.list(), reportRange('month', new Date())).completed).toHaveLength(2)
    const state = reports.snapshot(); reports.settings({ ...state.settings, projectIds: [research.id], projectsConfigured: true })
    const read = library.insert({ ...paper(), readingStatus: 'done' }); reports.readingDate({ paperId: read.id, date: '2026-09-30' })
    const group = randomUUID()
    const input = { title: '稿件', journal: 'Test', manuscriptId: '', stages: [{ name: 'Submitted to journal', occurredOn: '2026-09-01' }], revisionDueDate: null, reminderEnabled: false, reminderDays: 3, notes: '', manuscriptGroupId: group }
    submissions.create(input); submissions.create({ ...input, journal: 'Other' }); submissions.create({ ...input, manuscriptGroupId: randomUUID(), stages: [{ name: '准备投稿', occurredOn: '2026-09-10' }] })
    const data = reportData(reports.snapshot(), tasks.list(), library.papers(), submissions.list(), projects.list(), { start: '2026-09-01', end: '2026-09-30' })
    expect(data.completed).toHaveLength(1); expect(data.read).toHaveLength(1); expect(data.submitted).toBe(1); expect(data.rounds).toHaveLength(2)
    expect(data.buckets.reduce((sum, item) => sum + item.papers, 0)).toBe(1)
    expect(reportRange('week', new Date('2026-09-28T09:00:00'))).toEqual({ start: '2026-09-28', end: '2026-10-04' })
  })
})
