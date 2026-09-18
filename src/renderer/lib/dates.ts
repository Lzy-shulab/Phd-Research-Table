import { format, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
export const dateKey = (date = new Date()) => format(date, 'yyyy-MM-dd')
export const formatDate = (date: Date, pattern = 'yyyy年M月d日 EEEE') => format(date, pattern, { locale: zhCN })
export const calendarLabel = (date: string, pattern = 'M月d日') =>
  date === 'Unscheduled' ? '未安排日期' : formatDate(parseISO(date), pattern)
export { toMinutes as minutes, timeFromMinutes } from '../../domain/schedule'
export function durationLabel(value: number) {
  return value >= 60
    ? `${Math.floor(value / 60)}小时${value % 60 ? ` ${value % 60}分钟` : ''}`
    : `${value}分钟`
}
