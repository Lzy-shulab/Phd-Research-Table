import type { DesktopTaskDraft, Project, Task } from '../shared/types'
import { localDay } from '../shared/arxiv'
import { isCalendarDate } from './validation'

export const defaultTaskReminder = 30

const chineseDigits = '零一二三四五六七八九'
const chineseNumber = (text: string): number => {
  const digits = text.replaceAll('两', '二')
  if (/^\d+$/.test(digits)) return Number(digits)
  if (!digits.includes('十')) return chineseDigits.indexOf(digits)
  const [tens, ones] = digits.split('十')
  return 10 * (tens ? chineseDigits.indexOf(tens) : 1) + (ones ? chineseDigits.indexOf(ones) : 0)
}

const numberPattern = '[0-9零一二两三四五六七八九十]+'
const reminderPattern = new RegExp(
  '(?:[（(]\\s*)?提前\\s*(半|一个半|一个|' + numberPattern + ')\\s*个?\\s*(小时|钟头|分钟|分|天)' +
  '(?:\\s*(' + numberPattern + ')\\s*分(?:钟)?)?\\s*(?:提醒|通知|(?=[）)]|$))\\s*[）)]?'
)

export function readTaskReminder(note: string) {
  const normalized = note.normalize('NFKC')
  const onTime = /(?:[（(]\s*)?(?:准时|到点)(?:提醒|通知)\s*[）)]?/.exec(normalized)
  if (onTime) return { title: normalized.replace(onTime[0], ' ').trim() || note.trim(), minutes: 0 }
  const match = reminderPattern.exec(normalized)
  if (!match) return { title: note.trim(), minutes: null }
  const [, amount = '', unit, extra] = match
  const count = amount === '半' ? .5 : amount === '一个半' ? 1.5 : amount === '一个' ? 1 : chineseNumber(amount)
  const minutes = count * (unit === '天' ? 1440 : unit === '小时' || unit === '钟头' ? 60 : 1) + (extra ? chineseNumber(extra) : 0)
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 43_200) return { title: note.trim(), minutes: null }
  return { title: normalized.replace(match[0], ' ').trim() || note.trim(), minutes }
}

export function taskReminderMinutes(task: Pick<Task, 'title' | 'reminderMinutes'>) {
  return task.reminderMinutes ?? readTaskReminder(task.title).minutes ?? defaultTaskReminder
}

export function taskReminderLabel(minutes: number) {
  if (!minutes) return '准时提醒'
  if (minutes % 1440 === 0) return '提前 ' + (minutes / 1440) + ' 天'
  if (minutes % 60 === 0) return '提前 ' + (minutes / 60) + ' 小时'
  return '提前 ' + minutes + ' 分钟'
}

const clockPattern = new RegExp(
  '(?<![0-9第])(?:(凌晨|早上|上午|中午|下午|傍晚|晚上)\\s*)?' +
  '(?:(\\d{1,2}):([0-5]\\d)(?!\\d)|(' + numberPattern + ')\\s*[点时](?:\\s*(半|一刻|三刻|' + numberPattern + '\\s*分?))?)'
)
function readClock(text: string, inheritedPeriod?: string) {
  const match = clockPattern.exec(text)
  if (!match) return null
  const [, period = inheritedPeriod, hour24, minute24, chineseHour = '', chineseMinute] = match
  let hour = hour24 ? Number(hour24) : chineseNumber(chineseHour)
  const minute = minute24 ? Number(minute24) : chineseMinute === '半' ? 30 : chineseMinute === '一刻' ? 15 :
    chineseMinute === '三刻' ? 45 : chineseMinute ? chineseNumber(chineseMinute.replace(/分|\s/g, '')) : 0
  if (period && hour <= 12) {
    if (/下午|傍晚|晚上/.test(period) || period === '中午' && hour < 11) hour = hour % 12 + 12
    if (/凌晨|早上|上午/.test(period) && hour === 12) hour = 0
  }
  if ((!hour24 && !period && hour > 0 && hour < 13) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { time: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0'), index: match.index, length: match[0].length, period }
}

export function parseQuickDesktopTask(note: string, now = new Date()): DesktopTaskDraft {
  const reminder = readTaskReminder(note)
  let title = reminder.title.normalize('NFKC')
  let date: string | null = null
  const explicit = /\b\d{4}-\d{2}-\d{2}\b|(?:(\d{4})年\s*)?(\d{1,2})月\s*(\d{1,2})[日号]/.exec(title)
  const relative = /大后天|后天|明天|明早|明晚|今天|今晚|今早|今日/.exec(title)
  const weekday = /(下下|下|本|这)(?:周|星期)([一二三四五六日天])/.exec(title)
  if (explicit) {
    const [, year, month, day = ''] = explicit
    const parsed = month ? (year ?? now.getFullYear()) + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0') : explicit[0]
    if (isCalendarDate(parsed)) { date = parsed; title = title.replace(explicit[0], ' ') }
  } else if (relative) {
    const offset = /大后天/.test(relative[0]) ? 3 : /后天/.test(relative[0]) ? 2 : /明/.test(relative[0]) ? 1 : 0
    const day = new Date(now)
    day.setDate(day.getDate() + offset)
    date = localDay(day)
    title = title.replace(relative[0], relative[0].endsWith('早') ? '早上' : relative[0].endsWith('晚') ? '晚上' : ' ')
  } else if (weekday) {
    const week = weekday[1] === '下下' ? 2 : weekday[1] === '下' ? 1 : 0
    const dayOfWeek = /[日天]/.test(weekday[2] ?? '') ? 7 : chineseNumber(weekday[2] ?? '')
    const day = new Date(now)
    day.setDate(day.getDate() + 7 * week + dayOfWeek - (day.getDay() || 7))
    date = localDay(day)
    title = title.replace(weekday[0], ' ')
  }
  const clock = readClock(title)
  const tail = clock ? title.slice(clock.index + clock.length) : ''
  const range = /^\s*(?:到|至|[-—~～])\s*/.exec(tail)
  const end = range ? readClock(tail.slice(range[0].length), clock?.period) : null
  const unresolved = range && (!end || end.index !== 0 || end.time <= clock!.time)
  const startTime = clock && !unresolved ? clock.time : null
  if (clock && startTime) {
    const rest = end && range ? tail.slice(range[0].length + end.length) : tail
    if (!date && !/周[一二三四五六日天末]|星期|下月|月底|月初|下周|工作日|下个|下一个|过几天|\d+[日号]/.test(title)) date = localDay(now)
    if (date) title = title.slice(0, clock.index) + ' ' + rest
  }
  return { title: title.replace(/^[\s,，。:：]+|[\s,，。:：]+$/g, '').replace(/\s{2,}/g, ' ') || reminder.title,
    projectId: null, scheduledDate: date, startTime: date ? startTime : null, endTime: date && startTime ? end?.time ?? null : null,
    reminderMinutes: reminder.minutes }
}

export function hasClearDesktopSchedule(draft: DesktopTaskDraft, note: string) {
  return Boolean(draft.scheduledDate && draft.startTime && !/左右|之前|以后|之后|前后|尽量|或|每周/.test(readTaskReminder(note).title))
}

const normalizedWords = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const bigrams = (text: string) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2)))

export function desktopProjectCandidates(title: string, projects: Project[], tasks: Task[]) {
  const query = normalizedWords(title)
  const tokens = bigrams(query)
  const history = tasks.filter(task => task.status === 'completed' && task.projectId)
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))
  const options = projects.filter(project => !project.archivedAt).map(({ id, name, description }) => {
    const projectName = normalizedWords(name)
    const examples = [...new Set(history.filter(task => task.projectId === id).slice(0, 32)
      .map(task => readTaskReminder(task.title).title.slice(0, 90)))]
    const score = (example: string) => {
      const text = normalizedWords(example)
      if (text.length < 2) return 0
      if (text === query) return 1
      if (query.includes(text) || text.includes(query) && query.length >= 3) return .9
      const words = bigrams(text)
      const overlap = [...words].filter(word => tokens.has(word)).length
      return overlap > 1 ? 2 * overlap / (words.size + tokens.size) : 0
    }
    return { id, name, description: description.slice(0, 140), score: projectName.length >= 2 && query.includes(projectName) ? 2 : Math.max(0, ...examples.map(score)),
      examples: examples.sort((a, b) => score(b) - score(a)).slice(0, 4) }
  }).sort((a, b) => b.score - a.score)
  const [best, second] = options
  const projectId = best && (options.length === 1 || best.score >= .68 && best.score - (second?.score ?? 0) >= .15) ? best.id : null
  return { projectId, options }
}

export type DesktopTaskPeriod = 'today' | 'week' | 'month' | 'inbox'
export function desktopTaskMatches(task: Task, period: DesktopTaskPeriod, now = new Date()) {
  const today = localDay(now)
  if (period === 'inbox') return !task.scheduledDate && !task.dueDate
  const date = task.scheduledDate ?? task.dueDate
  if (!date) return false
  if (task.deferredUntil && task.deferredUntil > today) return false
  const end = new Date(now)
  if (period === 'week') end.setDate(end.getDate() + (7 - (end.getDay() || 7)))
  if (period === 'month') end.setMonth(end.getMonth() + 1, 0)
  // Keep unfinished overdue work visible; completed entries belong to their own period.
  const start = new Date(now)
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() || 7) - 1))
  if (period === 'month') start.setDate(1)
  return date <= localDay(end) && (task.status !== 'completed' || date >= localDay(start))
}
