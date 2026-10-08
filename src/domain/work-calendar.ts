import { rangeDays, type DateRange } from './reports'

// Research targets and calendar labels share Mainland China's official schedule.
export const holidayCalendars: Record<number, { source: string; holidays: [string, string][] }> = {
  2025: {
    source: 'https://www.forestry.gov.cn/c/www/szxx/594663.jhtml',
    holidays: [['2025-01-01', '2025-01-01'], ['2025-01-28', '2025-02-04'], ['2025-04-04', '2025-04-06'],
      ['2025-05-01', '2025-05-05'], ['2025-05-31', '2025-06-02'], ['2025-10-01', '2025-10-08']]
  },
  2026: {
    source: 'https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html',
    holidays: [['2026-01-01', '2026-01-03'], ['2026-02-15', '2026-02-23'], ['2026-04-04', '2026-04-06'],
      ['2026-05-01', '2026-05-05'], ['2026-06-19', '2026-06-21'], ['2026-09-25', '2026-09-27'], ['2026-10-01', '2026-10-07']]
  }
}
export function researchWorkday(date: string): boolean | null {
  const calendar = holidayCalendars[Number(date.slice(0, 4))]
  if (!calendar) return null
  if (makeUpWorkdays[Number(date.slice(0, 4))]?.includes(date)) return true
  const weekday = new Date(`${date}T12:00:00`).getDay()
  return weekday !== 0 && weekday !== 6 && !calendar.holidays.some(([start, end]) => date >= start && date <= end)
}
const makeUpWorkdays: Record<number, string[]> = {
  2025: ['2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11'],
  2026: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']
}
export function calendarDayMark(date: string): { kind: 'holiday' | 'rest' | 'work' | 'unknown'; label: string; badge: string } {
  const year = Number(date.slice(0, 4)), calendar = holidayCalendars[year]
  if (!calendar) return { kind: 'unknown', label: '该年份节假日安排未收录', badge: '' }
  const index = calendar.holidays.findIndex(([start, end]) => date >= start && date <= end)
  if (index >= 0) {
    const names = year === 2025 ? ['元旦', '春节', '清明节', '劳动节', '端午节', '国庆、中秋节'] : ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节']
    return { kind: 'holiday', label: `${names[index]}假期`, badge: '法' }
  }
  if (makeUpWorkdays[year]?.includes(date)) return { kind: 'work', label: '调休上班日', badge: '班' }
  const weekday = new Date(`${date}T12:00:00`).getDay()
  return weekday === 0 || weekday === 6 ? { kind: 'rest', label: '周末休息日', badge: '休' } : { kind: 'work', label: '工作日', badge: '' }
}
export function workdayTarget(range: DateRange) {
  const days = rangeDays(range).map(researchWorkday)
  const known = days.every(day => day !== null)
  const count = known ? days.filter(Boolean).length : 0
  return { known, days: count, minutes: count * 12 * 60 }
}
