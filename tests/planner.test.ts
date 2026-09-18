import { describe, expect, it } from 'vitest'
import { selectTasks, groupTasks, sortTasks } from '../src/domain/planner'
import { layoutSchedule, MINUTE_HEIGHT, minuteAtPosition, moveInterval, toMinutes, timeFromMinutes } from '../src/domain/schedule'
import type { Task } from '../src/shared/types'

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  title: id,
  description: '',
  status: 'inbox',
  projectId: null,
  priority: 'none',
  scheduledDate: null,
  startTime: null,
  endTime: null,
  dueDate: null,
  estimatedMinutes: null,
  order: 0,
  createdAt: '2026-09-05T00:00:00Z',
  updatedAt: '2026-09-05T00:00:00Z',
  completedAt: null,
  ...patch
})
describe('Planner view semantics', () => {
  it('preserves arbitrary minute geometry independently of hour grid lines', () => {
    for (const [startTime, endTime] of [['09:17', '09:43'], ['10:05', '11:38'], ['13:22', '15:07'], ['16:01', '16:46'], ['18:13', '20:51']]) {
      const block = layoutSchedule([task('minute', { startTime, endTime })])[0]!
      expect(timeFromMinutes(block.start)).toBe(startTime)
      expect(timeFromMinutes(block.end)).toBe(endTime)
      expect(minuteAtPosition(block.start * MINUTE_HEIGHT)).toBe(toMinutes(startTime!))
    }
    for (let minute = 0; minute < 1440; minute++) {
      expect(minuteAtPosition(minute * MINUTE_HEIGHT)).toBe(minute)
      expect(toMinutes(timeFromMinutes(minute))).toBe(minute)
    }
  })
  it('moves by single minutes and preserves duration at both day boundaries', () => {
    expect(moveInterval(612, 698, 1)).toEqual({ start: 613, end: 699 })
    expect(moveInterval(612, 698, 2)).toEqual({ start: 614, end: 700 })
    expect(moveInterval(612, 698, -999)).toEqual({ start: 0, end: 86 })
    expect(moveInterval(612, 698, 999)).toEqual({ start: 1353, end: 1439 })
    expect(moveInterval(1430, null, 99)).toEqual({ start: 1439, end: null })
  })
  it('keeps partial and invalid editor drafts out of calendar geometry', () => {
    expect(layoutSchedule([task('partial', { startTime: '09:' })])).toEqual([])
    const draft = task('invalid', { startTime: '09:17', endTime: '08:00' })
    expect(layoutSchedule([draft])[0]).toMatchObject({ start: 557, end: 587 })
    expect(draft.endTime).toBe('08:00')
  })
  const tasks = [
    task('inbox'),
    task('today', { scheduledDate: '2026-09-05', status: 'planned', projectId: 'p' }),
    task('future', { scheduledDate: '2026-09-08', status: 'planned' }),
    task('past', { scheduledDate: '2026-09-01', status: 'planned' }),
    task('done', { status: 'completed', completedAt: '2026-09-05T01:00:00Z' }),
    task('due-only', { dueDate: '2026-09-05' })
  ]
  it('shows only today in Today Plan and retains past work in all tasks', () => {
    expect(selectTasks(tasks, 'inbox', '2026-09-05', null).map((t) => t.id)).toEqual([
      'inbox',
      'due-only'
    ])
    expect(selectTasks(tasks, 'today', '2026-09-05', null).map((t) => t.id)).toEqual(['today', 'due-only'])
    expect(selectTasks(tasks, 'upcoming', '2026-09-05', null).map((t) => t.id)).toEqual(['future'])
    expect(selectTasks(tasks, 'all', '2026-09-05', null)).toHaveLength(6)
    expect(selectTasks(tasks, 'project', '2026-09-05', 'p').map((t) => t.id)).toEqual(['today'])
    expect(selectTasks(tasks, 'completed', '2026-09-05', null).map((t) => t.id)).toEqual(['done'])
    expect(groupTasks(selectTasks(tasks, 'upcoming', '2026-09-05', null))).toHaveLength(1)
  })
  it('sorts time slots and keeps unspecified dates at the end', () => {
    const rows = [
      task('anytime', { scheduledDate: '2026-09-05' }),
      task('later', { scheduledDate: '2026-09-05', startTime: '14:00' }),
      task('early', { scheduledDate: '2026-09-05', startTime: '09:00' }),
      task('unscheduled')
    ]
    expect(sortTasks(rows, 'scheduled').map((t) => t.id)).toEqual([
      'early',
      'later',
      'anytime',
      'unscheduled'
    ])
  })
  it('keeps project views scoped while global task views ignore a previous project', () => {
    const scoped = [
      task('p-today', { projectId: 'p', scheduledDate: '2026-09-05', status: 'planned' }),
      task('other-today', { projectId: 'q', scheduledDate: '2026-09-05', status: 'planned' }),
      task('p-future', { projectId: 'p', scheduledDate: '2026-09-08', status: 'planned' }),
      task('p-done', { projectId: 'p', status: 'completed', completedAt: '2026-09-05T01:00:00Z' }),
      task('q-done', { projectId: 'q', status: 'completed', completedAt: '2026-09-05T01:00:00Z' })
    ]
    expect(selectTasks(scoped, 'today', '2026-09-05', 'p').map((t) => t.id)).toEqual(['p-today', 'other-today'])
    expect(selectTasks(scoped, 'all', '2026-09-05', 'p')).toEqual(scoped)
    expect(selectTasks(scoped, 'project', '2026-09-05', 'p').map((t) => t.id)).toEqual(['p-today', 'p-future'])
    expect(selectTasks(scoped, 'upcoming', '2026-09-05', 'p').map((t) => t.id)).toEqual(['p-future'])
    expect(selectTasks(scoped, 'completed', '2026-09-05', 'p').map((t) => t.id)).toEqual(['p-done'])
    expect(selectTasks(scoped, 'calendar', '2026-09-05', 'p').map((t) => t.id)).toEqual(['p-today', 'other-today', 'p-future'])
  })
  it('lays overlapping intervals in columns and reuses full width afterward', () => {
    const blocks = layoutSchedule([
      task('a', { startTime: '09:00', endTime: '11:00' }),
      task('b', { startTime: '10:00', endTime: '12:00' }),
      task('c', { startTime: '11:00', endTime: '11:30' }),
      task('d', { startTime: '12:00', endTime: '13:00' })
    ])
    expect(blocks.map((b) => [b.task.id, b.column, b.columns])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 2],
      ['d', 0, 1]
    ])
  })
  it('renders a start-only marker without inventing a stored duration', () => {
    const late = task('late', { startTime: '23:50' })
    expect(layoutSchedule([late])[0]).toMatchObject({ start: 1430, end: 1440 })
    expect(late.endTime).toBeNull()
  })
})
