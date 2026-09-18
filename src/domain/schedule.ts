import type { Task } from '../shared/types'
export const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
export const isLocalTime = (time: string | null | undefined): time is string => !!time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
export const HOUR_HEIGHT = 72
export const MINUTE_HEIGHT = HOUR_HEIGHT / 60
export const clampMinute = (value: number, min = 0, max = 1439) => Math.max(min, Math.min(max, Math.round(value)))
export const minuteAtPosition = (offset: number) => clampMinute(offset / MINUTE_HEIGHT)
export const timeFromMinutes = (value: number) =>
  `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`
export function moveInterval(start: number, end: number | null, delta: number) {
  const duration = end === null ? 0 : end - start
  const next = clampMinute(start + delta, 0, 1439 - duration)
  return { start: next, end: end === null ? null : next + duration }
}
export interface ScheduleBlock {
  task: Task
  start: number
  end: number
  column: number
  columns: number
}
export function layoutSchedule(tasks: Task[]): ScheduleBlock[] {
  const sorted = tasks
    .filter((t) => isLocalTime(t.startTime))
    .sort((a, b) => a.startTime!.localeCompare(b.startTime!) || a.order - b.order)
  const output: ScheduleBlock[] = []
  let group: ScheduleBlock[] = [],
    columnEnds: number[] = [],
    groupEnd = -1
  const finish = () => {
    for (const block of group) {
      block.columns = columnEnds.length
      output.push(block)
    }
    group = []
    columnEnds = []
    groupEnd = -1
  }
  for (const task of sorted) {
    const start = toMinutes(task.startTime!)
    // Incomplete editor drafts stay editable but must never produce NaN or negative geometry.
    const end = isLocalTime(task.endTime) && toMinutes(task.endTime) > start
      ? toMinutes(task.endTime) : Math.min(start + 30, 1440)
    if (start >= groupEnd) finish()
    let column = columnEnds.findIndex((value) => value <= start)
    if (column < 0) column = columnEnds.length
    columnEnds[column] = end
    groupEnd = Math.max(groupEnd, end)
    group.push({ task, start, end, column, columns: 1 })
  }
  finish()
  return output
}
