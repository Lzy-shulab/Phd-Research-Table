import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { attendanceMonthPeriod, widgetPatchSchema } from '../src/domain/widget'
import { defaultReportSettings, type ReportSnapshot } from '../src/shared/reports'
import { defaultWidgetPreferences } from '../src/shared/widget'
import { openDatabase } from '../src/main/database/db'
import { SettingsRepository } from '../src/main/database/repositories/settings'
import { LibraryRepository } from '../src/main/database/repositories/library'

const snapshot = (checkins: ReportSnapshot['checkins'], absences: ReportSnapshot['absences'] = []): ReportSnapshot => ({ settings: defaultReportSettings, stipends: [], readingDates: {}, checkins, absences })

describe('selected attendance months', () => {
  it('totals the selected whole months against their existing workday target', () => {
    const data = snapshot([
      { id: 'july', date: '2026-07-01', durationMinutes: 240, notes: '', createdAt: '' },
      { id: 'august', date: '2026-08-05', durationMinutes: 360, notes: '', createdAt: '' },
      { id: 'outside', date: '2026-06-30', durationMinutes: 720, notes: '', createdAt: '' }
    ])
    expect(attendanceMonthPeriod(data, '2026-07', '2026-08')).toEqual({ range: { start: '2026-07-01', end: '2026-08-31' }, minutes: 600, target: 31680, percent: 2 })
    expect(attendanceMonthPeriod(data, '2026-08', '2026-08').minutes).toBe(360)
    expect(data.checkins).toHaveLength(3)
  })
  it('keeps overnight splits and absence deductions consistent with weekly and monthly totals', () => {
    const data = snapshot([
      { id: 'night', date: '2026-07-31', startTime: '23:00', endTime: '01:00', endsNextDay: true, durationMinutes: 120, notes: '', createdAt: '' },
      { id: 'trip-record', date: '2026-07-02', durationMinutes: 240, notes: '', createdAt: '' }
    ], [{ id: 'trip', kind: 'trip', startDate: '2026-07-02', endDate: '2026-07-02', notes: '', createdAt: '' }])
    expect(attendanceMonthPeriod(data, '2026-07', '2026-07')).toMatchObject({ minutes: 60, target: 15840 })
    expect(attendanceMonthPeriod(data, '2026-08', '2026-08').minutes).toBe(60)
    expect(attendanceMonthPeriod(data, '2026-07', '2026-08').minutes).toBe(120)
  })
  it('supports cross-year periods and rejects reversed month selections', () => {
    expect(attendanceMonthPeriod(snapshot([]), '2025-12', '2026-01').range).toEqual({ start: '2025-12-01', end: '2026-01-31' })
    expect(widgetPatchSchema.safeParse({ attendancePeriod: { startMonth: '2026-08', endMonth: '2026-07' } }).success).toBe(false)
    expect(widgetPatchSchema.parse({ glassOpacity: .6 })).toEqual({ glassOpacity: .6 })
  })
})

it('does not write unchanged settings and reader session values to SQLite again', () => {
  const connection = openDatabase(':memory:', resolve('src/main/database/migrations'))
  try {
    const settings = new SettingsRepository(connection.db), library = new LibraryRepository(connection.db)
    const changes = () => (connection.sqlite.prepare('select total_changes() as count').get() as { count: number }).count
    settings.setWidget(defaultWidgetPreferences); library.setSetting('reader.last-session', '{"paperId":"test","variant":"source"}')
    const first = changes()
    settings.setWidget(defaultWidgetPreferences); library.setSetting('reader.last-session', '{"paperId":"test","variant":"source"}')
    expect(changes()).toBe(first)
    settings.setWidget({ ...defaultWidgetPreferences, attendancePeriod: { startMonth: '2026-07', endMonth: '2026-08' } })
    expect(changes()).toBe(first + 1)
  } finally { connection.close() }
})
