import { z } from 'zod'
import { localDay } from '../shared/arxiv'
import { defaultWidgetPreferences, desktopShortcuts, widgetDimensions, widgetMaterials, widgetThemes, type WidgetPreferences } from '../shared/widget'
import type { ReportSnapshot } from '../shared/reports'
import { checkinAbsenceForDate, checkinDayParts, rangeDays, reportRange, type DateRange } from './reports'
import { workdayTarget } from './work-calendar'

export const widgetCitySchema = z.object({
  id: z.number().int().nonnegative(), name: z.string().trim().min(1).max(100),
  region: z.string().max(100), country: z.string().max(100),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180)
}).strict()
const widgetFields = {
  enabled: z.boolean(), openAtLogin: z.boolean(), alwaysOnTop: z.boolean(),
  glassOpacity: z.number().min(0.35).max(0.9), city: widgetCitySchema.nullable(),
  theme: z.enum(widgetThemes),
  material: z.enum(widgetMaterials),
  scale: z.number().min(0.6).max(1).nullable(),
  focusText: z.string().trim().max(80),
  railOrder: z.array(z.enum(desktopShortcuts)).max(6).refine(items => new Set(items).size === items.length),
  hiddenPanels: z.array(z.enum(desktopShortcuts)).max(6).refine(items => new Set(items).size === items.length),
  attendancePeriod: z.object({ startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), endMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict().refine(period => period.startMonth <= period.endMonth, '结束月份不能早于开始月份。').nullable()
}
export const widgetPatchSchema = z.object(widgetFields).partial().strict()
export const widgetPreferencesSchema = z.object({ ...widgetFields,
  theme: widgetFields.theme.default(defaultWidgetPreferences.theme),
  material: widgetFields.material.default(defaultWidgetPreferences.material).transform(() => 'rounded' as const),
  scale: widgetFields.scale.default(null),
  railOrder: widgetFields.railOrder.default([...desktopShortcuts]),
  hiddenPanels: widgetFields.hiddenPanels.default([]),
  attendancePeriod: widgetFields.attendancePeriod.default(null),
  position: z.object({ x: z.number().int(), y: z.number().int() }).strict().nullable()
}).strict()
export const widgetWeatherSchema = z.object({ cityId: z.number().int(), temperature: z.number(),
  code: z.number().int(), isDay: z.boolean(), fetchedAt: z.number().nonnegative() }).strict()
export function readWidgetPreferences(value: unknown): WidgetPreferences {
  const preferences = widgetPreferencesSchema.safeParse(value).data ?? { ...defaultWidgetPreferences }
  return { ...preferences, railOrder: [...preferences.railOrder, ...desktopShortcuts.filter(id => !preferences.railOrder.includes(id))] }
}
export function widgetLayout(requestedScale: number | null, workArea: { width: number; height: number }, compact = false) {
  const { width, height, focusHeight, margin } = widgetDimensions
  const canvasWidth = width + margin * 2, canvasHeight = height + margin * 2
  const fit = Math.min((workArea.width - 16) / canvasWidth, (workArea.height - 16) / canvasHeight, 1)
  const scale = Math.floor(Math.min(requestedScale ?? 1, fit) * 1000) / 1000
  return { scale, width: Math.ceil(canvasWidth * scale), height: Math.ceil(((compact ? focusHeight : height) + margin * 2) * scale) }
}
export function roundedWidgetRegion(width: number, height: number, radius: number) {
  const r = Math.min(Math.round(radius), Math.floor(width / 2), Math.floor(height / 2))
  const regions = [{ x: 0, y: r, width, height: height - 2 * r }]
  for (let y = 0; y < r; y++) {
    const inset = Math.ceil(r - Math.sqrt(r * r - (r - y - .5) ** 2))
    regions.push({ x: inset, y, width: width - 2 * inset, height: 1 }, { x: inset, y: height - y - 1, width: width - 2 * inset, height: 1 })
  }
  return regions
}
export function widgetStatistics(snapshot: ReportSnapshot, now = new Date()) {
  const date = localDay(now)
  const period = (type: 'week' | 'month') => {
    const range = reportRange(type, now)
    const target = workdayTarget(range, snapshot.absences)
    const minutes = attendanceMinutes(snapshot, range)
    return { range, minutes, target: target.known ? target.minutes : null,
      percent: target.known && target.minutes > 0 ? Math.round(minutes / target.minutes * 100) : null }
  }
  const absence = checkinAbsenceForDate(snapshot.absences, date)
  const target = workdayTarget({ start: date, end: date }, snapshot.absences)
  const entries = snapshot.checkins.filter(entry => checkinDayParts(entry).some(part => part.date === date))
  const recordedMinutes = entries.flatMap(checkinDayParts).filter(part => part.date === date).reduce((sum, part) => sum + part.minutes, 0)
  return { week: period('week'), month: period('month'), today: { date, entries, absence,
    minutes: absence ? 0 : recordedMinutes, recordedMinutes, target: target.known ? target.minutes : null } }
}
export function attendanceMinutes(snapshot: ReportSnapshot, range: DateRange) {
  return snapshot.checkins.reduce((sum, entry) => sum + checkinDayParts(entry)
    .filter(part => part.date >= range.start && part.date <= range.end && !checkinAbsenceForDate(snapshot.absences, part.date))
    .reduce((total, part) => total + part.minutes, 0), 0)
}
export function attendanceMonthPeriod(snapshot: ReportSnapshot, startMonth: string, endMonth: string) {
  const [year, month] = endMonth.split('-').map(Number)
  const end = new Date(year!, month!, 0, 12)
  const range = { start: startMonth + '-01', end: localDay(end) }
  const target = workdayTarget(range, snapshot.absences)
  const minutes = attendanceMinutes(snapshot, range)
  return { range, minutes, target: target.known ? target.minutes : null, percent: target.known && target.minutes > 0 ? Math.round(minutes / target.minutes * 100) : null }
}
export function widgetHours(minutes: number) {
  return (minutes / 60).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
}
export function widgetAttendanceDays(snapshot: ReportSnapshot, range: DateRange, today = localDay()) {
  return rangeDays(range).map(date => {
    const segments = snapshot.checkins.flatMap(entry => {
      const part = checkinDayParts(entry).find(part => part.date === date)
      if (!part) return []
      return [{ id: entry.id, minutes: part.minutes,
        startTime: entry.startTime ? entry.date === date ? entry.startTime : '00:00' : null,
        endTime: entry.endTime ? entry.endsNextDay && entry.date === date ? '24:00' : entry.endTime : null,
        continuesFromPreviousDay: entry.date !== date,
        continuesToNextDay: Boolean(entry.endsNextDay && entry.date === date && entry.endTime !== '00:00') }]
    }).sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
    const absence = checkinAbsenceForDate(snapshot.absences, date)
    const recordedMinutes = segments.reduce((sum, segment) => sum + segment.minutes, 0)
    return { date, segments, absence, recordedMinutes, countedMinutes: absence ? 0 : recordedMinutes,
      isToday: date === today, isFuture: date > today }
  })
}
export function widgetDuration(minutes: number) {
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return hours ? `${hours}小时${rest ? `${rest}分` : ''}` : `${rest}分钟`
}
export function focusElapsed(startedAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':')
}
export function weatherDescription(code: number) {
  if (code === 0) return '晴'
  if (code === 1) return '晴间多云'
  if (code === 2) return '多云'
  if (code === 3) return '阴'
  if (code === 45 || code === 48) return '雾'
  if ([56, 57, 66, 67].includes(code)) return '冻雨'
  if (code >= 51 && code <= 55) return '毛毛雨'
  if (code === 61) return '小雨'
  if (code === 63) return '中雨'
  if (code === 65) return '大雨'
  if (code >= 71 && code <= 77) return '雪'
  if (code >= 80 && code <= 82) return '阵雨'
  if (code === 85 || code === 86) return '阵雪'
  if (code >= 95) return '雷雨'
  return '天气未知'
}
