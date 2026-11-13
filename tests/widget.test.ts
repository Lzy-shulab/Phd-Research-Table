import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultReportSettings, type ReportSnapshot } from '../src/shared/reports'
import { defaultWidgetPreferences, type WidgetCity } from '../src/shared/widget'
import { focusElapsed, readWidgetPreferences, weatherDescription, widgetAttendanceDays, widgetLayout, widgetPatchSchema, widgetStatistics } from '../src/domain/widget'
import { WidgetWeatherService } from '../src/main/widget/weather'
import type { SettingsRepository } from '../src/main/database/repositories/settings'

afterEach(() => vi.useRealTimers())
const city: WidgetCity = { id: 1, name: '杭州', region: '浙江', country: '中国', latitude: 30.27, longitude: 120.16 }
describe('proportional widget sizing', () => {
  it('uses readable full size by default and adapts only when the work area is smaller', () => {
    expect(widgetLayout(null, { width: 2048, height: 1104 })).toEqual({ scale: 1, width: 480, height: 720 })
    expect(widgetLayout(null, { width: 1366, height: 728 }).scale).toBe(0.988)
    expect(widgetLayout(0.65, { width: 2048, height: 1104 }, true)).toEqual({ scale: 0.65, width: 312, height: 208 })
  })
  it('adds automatic sizing without resetting earlier preferences or unrelated patches', () => {
    const previous = { enabled: true, openAtLogin: false, alwaysOnTop: true, glassOpacity: 0.7,
      city, position: { x: 1500, y: 20 }, focusText: '阅读论文' }
    expect(readWidgetPreferences(previous)).toEqual({ ...previous, theme: 'graphite', material: 'rounded', scale: null, railOrder: defaultWidgetPreferences.railOrder, hiddenPanels: [], attendancePeriod: null })
    expect(readWidgetPreferences({ ...previous, material: 'acrylic', theme: 'ocean' })).toMatchObject({ material: 'rounded', theme: 'ocean' })
    expect(widgetPatchSchema.parse({ glassOpacity: 0.6 })).toEqual({ glassOpacity: 0.6 })
  })
  it('keeps ordering and hidden entries when changing another preference', () => {
    const preferences = { ...defaultWidgetPreferences, railOrder: ['reading', 'checkin', 'tasks', 'submissions', 'gpu', 'codex'], hiddenPanels: ['gpu', 'codex'], glassOpacity: 0.75 }
    expect(readWidgetPreferences(preferences)).toEqual(preferences)
    expect(widgetPatchSchema.parse({ hiddenPanels: ['gpu'] })).toEqual({ hiddenPanels: ['gpu'] })
    expect(readWidgetPreferences({ ...preferences, ...widgetPatchSchema.parse({ alwaysOnTop: true }) })).toEqual({ ...preferences, alwaysOnTop: true })
  })
})
function weatherStore() {
  let preferences = { ...defaultWidgetPreferences, city }
  let weather: unknown
  const store = { getWidget: () => preferences, getWidgetWeather: () => weather, setWidgetWeather: (next: unknown) => { weather = next } }
  return { repo: () => store as unknown as SettingsRepository, changeCity: () => { preferences = { ...preferences, city: { ...city, id: 2, name: '南京' } } } }
}
describe('desktop attendance statistics', () => {
  it('lists every date with separate time segments, actual daily duration and explicit missing times', () => {
    const snapshot: ReportSnapshot = { settings: defaultReportSettings, stipends: [], readingDates: {}, absences: [], checkins: [
      { id: 'morning', date: '2026-10-02', startTime: '09:00', endTime: '12:00', durationMinutes: 180, notes: '', createdAt: '' },
      { id: 'afternoon', date: '2026-10-02', startTime: '14:00', endTime: '16:30', durationMinutes: 150, notes: '', createdAt: '' },
      { id: 'legacy', date: '2026-10-03', durationMinutes: 90, notes: '', createdAt: '' }
    ] }
    const rows = widgetAttendanceDays(snapshot, { start: '2026-10-01', end: '2026-10-31' }, '2026-10-03')
    expect(rows).toHaveLength(31)
    expect(rows[0]).toMatchObject({ date: '2026-10-01', segments: [], recordedMinutes: 0, isFuture: false })
    expect(rows[1]).toMatchObject({ recordedMinutes: 330, countedMinutes: 330,
      segments: [{ startTime: '09:00', endTime: '12:00' }, { startTime: '14:00', endTime: '16:30' }] })
    expect(rows[2]).toMatchObject({ isToday: true, recordedMinutes: 90, segments: [{ startTime: null, endTime: null }] })
    expect(rows[30]).toMatchObject({ date: '2026-10-31', isFuture: true, segments: [] })
  })
  it('splits overnight time at the month boundary and retains absence-day records without counting them', () => {
    const snapshot: ReportSnapshot = { settings: defaultReportSettings, stipends: [], readingDates: {},
      checkins: [{ id: 'overnight', date: '2026-09-30', startTime: '23:00', endTime: '02:00', endsNextDay: true, durationMinutes: 180, notes: '', createdAt: '' }],
      absences: [{ id: 'trip', kind: 'trip', startDate: '2026-10-01', endDate: '2026-10-01', notes: '', createdAt: '' }] }
    const before = structuredClone(snapshot)
    const september = widgetAttendanceDays(snapshot, { start: '2026-09-30', end: '2026-09-30' })
    const october = widgetAttendanceDays(snapshot, { start: '2026-10-01', end: '2026-10-07' })
    expect(september[0]).toMatchObject({ recordedMinutes: 60, segments: [{ startTime: '23:00', endTime: '24:00', continuesToNextDay: true }] })
    expect(october[0]).toMatchObject({ recordedMinutes: 120, countedMinutes: 0, absence: { kind: 'trip' },
      segments: [{ startTime: '00:00', endTime: '02:00', continuesFromPreviousDay: true }] })
    expect(snapshot).toEqual(before)
  })
  it('uses Monday through Sunday, splits midnight and excludes absence days without altering entries', () => {
    const snapshot: ReportSnapshot = { settings: defaultReportSettings, stipends: [], readingDates: {},
      checkins: [
        { id: 'first', date: '2026-09-07', startTime: '23:00', endTime: '02:00', endsNextDay: true, durationMinutes: 180, notes: '', createdAt: '' },
        { id: 'second', date: '2026-09-09', startTime: '09:00', endTime: '12:00', durationMinutes: 180, notes: '', createdAt: '' }
      ], absences: [{ id: 'leave', kind: 'leave', startDate: '2026-09-08', endDate: '2026-09-08', notes: '', createdAt: '' }] }
    const before = structuredClone(snapshot)
    const result = widgetStatistics(snapshot, new Date('2026-09-09T12:00:00'))
    expect(result.week.range).toMatchObject({ start: '2026-09-07', end: '2026-09-13' })
    expect(result.week.minutes).toBe(240)
    expect(result.week.target).toBe(4 * 720)
    expect(result.month.minutes).toBe(240)
    expect(result.today).toMatchObject({ minutes: 180, target: 720 })
    const absent = widgetStatistics(snapshot, new Date('2026-09-08T12:00:00')).today
    expect(absent).toMatchObject({ minutes: 0, recordedMinutes: 120, target: 0 })
    expect(snapshot).toEqual(before)
  })
  it('keeps a full cross-month week and uses the same counted minutes in the ring and daily rows', () => {
    const snapshot: ReportSnapshot = { settings: defaultReportSettings, stipends: [], readingDates: {}, absences: [], checkins: [
      { id: 'monday', date: '2026-10-26', startTime: '09:00', endTime: '12:00', durationMinutes: 180, notes: '', createdAt: '' },
      { id: 'overnight', date: '2026-10-31', startTime: '23:00', endTime: '01:00', endsNextDay: true, durationMinutes: 120, notes: '', createdAt: '' },
      { id: 'sunday', date: '2026-11-01', startTime: '09:00', endTime: '10:00', durationMinutes: 60, notes: '', createdAt: '' },
      { id: 'outside', date: '2026-11-02', durationMinutes: 300, notes: '', createdAt: '' }
    ] }
    for (const day of ['2026-10-26', '2026-10-30', '2026-11-01']) {
      const result = widgetStatistics(snapshot, new Date(`${day}T12:00:00`))
      expect(result.week.range).toEqual({ start: '2026-10-26', end: '2026-11-01' })
      expect(result.week).toMatchObject({ minutes: 360, target: 3600, percent: 10 })
      const rows = widgetAttendanceDays(snapshot, result.week.range, day)
      expect(rows.map(row => row.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
      expect(rows.reduce((sum, row) => sum + row.countedMinutes, 0)).toBe(result.week.minutes)
    }
    const october = widgetStatistics(snapshot, new Date('2026-10-30T12:00:00')).month
    expect(october.range).toEqual({ start: '2026-10-01', end: '2026-10-31' })
    expect(october.minutes).toBe(240)
    expect(widgetStatistics(snapshot, new Date('2026-11-02T00:00:00')).week.range).toEqual({ start: '2026-11-02', end: '2026-11-08' })
  })
  it('keeps missing calendar targets distinct from rest days, and uses elapsed wall time', () => {
    const empty: ReportSnapshot = { settings: defaultReportSettings, stipends: [], readingDates: {}, checkins: [], absences: [] }
    expect(widgetStatistics(empty, new Date('2026-10-03T12:00:00')).today.target).toBe(0)
    expect(widgetStatistics(empty, new Date('2027-01-03T12:00:00')).today.target).toBeNull()
    expect(focusElapsed(1000, 1000 + 3_661_000)).toBe('01:01:01')
  })
})
describe('widget weather', () => {
  it('caches current weather, keeps its timestamp when offline, and never reuses a different city', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000000)
    const store = weatherStore()
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ current: { temperature_2m: 23.4, weather_code: 2, is_day: 1 } })))
      .mockRejectedValue(new Error('offline'))
    const service = new WidgetWeatherService(store.repo, request)
    const first = await service.read()
    expect(first).toMatchObject({ stale: false, weather: { cityId: 1, temperature: 23.4, code: 2, fetchedAt: 1000000 } })
    expect(await service.read()).toEqual(first)
    expect(request).toHaveBeenCalledTimes(1)
    vi.setSystemTime(2000000)
    expect(await service.read()).toMatchObject({ stale: true, weather: { cityId: 1, fetchedAt: 1000000 } })
    store.changeCity()
    expect(await service.read()).toMatchObject({ weather: null, stale: true })
    expect(weatherDescription(2)).toBe('多云')
  })
  it('normalizes real city search results without requiring optional region names', async () => {
    const store = weatherStore()
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [{ id: 1, name: '杭州', latitude: 30.27, longitude: 120.16 }] })))
    expect(await new WidgetWeatherService(store.repo, request).search('杭州')).toEqual([{ ...city, country: '', region: '' }])
    const url = request.mock.calls[0]?.[0] as URL
    expect(url.hostname).toBe('geocoding-api.open-meteo.com')
    expect(url.searchParams.get('language')).toBe('zh')
  })
})
