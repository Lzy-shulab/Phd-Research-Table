import { describe, expect, it, vi } from 'vitest'
import { desktopProjectCandidates, desktopTaskMatches, hasClearDesktopSchedule, parseQuickDesktopTask } from '../src/domain/desktop-tasks'
import { DesktopNotices } from '../src/main/widget/desktop-notices'
import type { SettingsRepository } from '../src/main/database/repositories/settings'
import type { Project, Task } from '../src/shared/types'

const now = new Date('2026-11-03T12:00:00')
const task = (patch: Partial<Task>) => ({ scheduledDate: null, dueDate: null, deferredUntil: null, status: 'inbox', ...patch } as Task)
describe('desktop task periods', () => {
  it('includes overdue unfinished tasks in today, but not completed older tasks', () => {
    expect(desktopTaskMatches(task({ scheduledDate: '2026-11-01' }), 'today', now)).toBe(true)
    expect(desktopTaskMatches(task({ scheduledDate: '2026-11-01', status: 'completed' }), 'today', now)).toBe(false)
  })
  it('uses calendar week and month boundaries', () => {
    expect(desktopTaskMatches(task({ scheduledDate: '2026-11-08' }), 'week', now)).toBe(true)
    expect(desktopTaskMatches(task({ scheduledDate: '2026-11-09' }), 'week', now)).toBe(false)
    expect(desktopTaskMatches(task({ dueDate: '2026-11-30' }), 'month', now)).toBe(true)
    expect(desktopTaskMatches(task({ dueDate: '2026-12-01' }), 'month', now)).toBe(false)
  })
  it('keeps unscheduled work in inbox and respects deferral', () => {
    expect(desktopTaskMatches(task({}), 'inbox', now)).toBe(true)
    expect(desktopTaskMatches(task({ dueDate: '2026-11-04' }), 'inbox', now)).toBe(false)
    expect(desktopTaskMatches(task({ scheduledDate: '2026-11-01', deferredUntil: '2026-11-04' }), 'today', now)).toBe(false)
  })
})

describe('desktop task capture and reminders', () => {
  it('recognizes a timed task and reminder locally and uses completed tasks for its project', () => {
    const note = '明天下午六点半保利熙悦家教（提前三个小时通知）'
    const draft = parseQuickDesktopTask(note, now)
    expect(draft).toEqual({ title: '保利熙悦家教', projectId: null, scheduledDate: '2026-11-04', startTime: '18:30', endTime: null, reminderMinutes: 180 })
    expect(hasClearDesktopSchedule(draft, note)).toBe(true)
    const projects = [{ id: 'daily', name: '日常任务', description: '', archivedAt: null }, { id: 'paper', name: '论文', description: '', archivedAt: null }] as Project[]
    const history = [
      task({ title: '家教', projectId: 'daily', status: 'completed', completedAt: now.toISOString() }),
      task({ title: '保利熙悦家教', projectId: 'paper', status: 'planned' })
    ]
    expect(desktopProjectCandidates(draft.title, projects, history).projectId).toBe('daily')
    expect(parseQuickDesktopTask('下周四18:30做实验', now).scheduledDate).toBe('2026-11-12')
    const ambiguous = '下一个工作日下午四点做实验'
    expect(hasClearDesktopSchedule(parseQuickDesktopTask(ambiguous, now), ambiguous)).toBe(false)
  })

  it('shows a legacy title reminder at its lead time, remembers receipt, and requeues after rescheduling', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-03T15:29:59'))
    let state: unknown
    const settings = {
      getDesktopNotices: () => state,
      setDesktopNotices: (next: unknown) => { state = next }
    } as SettingsRepository
    const entry = task({ id: 'lesson', title: '保利熙悦家教（提前三个小时通知）', scheduledDate: '2026-11-03', startTime: '18:30', status: 'planned' })
    const notices = new DesktopNotices(() => settings, () => [entry], () => false, () => {})
    try {
      notices.refreshTasks()
      expect(notices.pending()).toEqual([])
      vi.advanceTimersByTime(1000)
      expect(notices.pending()).toMatchObject([{ title: '18:30 开始', detail: '保利熙悦家教' }])
      notices.acknowledge(notices.pending()[0]!.id)
      notices.refreshTasks()
      expect(notices.pending()).toEqual([])
      entry.startTime = '15:00'
      entry.reminderMinutes = 0
      notices.refreshTasks()
      expect(notices.pending()).toMatchObject([{ title: '15:00 已到时间' }])
      entry.status = 'completed'
      notices.refreshTasks()
      expect(notices.pending()).toEqual([])
    } finally { notices.stop(); vi.useRealTimers() }
  })
})
