import { afterEach, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { openDatabase } from '../src/main/database/db'
import { SettingsRepository } from '../src/main/database/repositories/settings'
import { ProjectRepository } from '../src/main/database/repositories/projects'
import { TaskRepository } from '../src/main/database/repositories/tasks'
import { DesktopNotices } from '../src/main/widget/desktop-notices'

afterEach(() => vi.useRealTimers())

it('sends a task reminder exactly 30 minutes before start and preserves its receipt across restarts', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T14:29:00'))
  const db = openDatabase(':memory:', resolve('src/main/database/migrations'))
  const repo = new TaskRepository(db.db)
  const project = new ProjectRepository(db.db).create({ name: '实验', description: '', colorKey: 'blue' })
  const task = repo.create({ title: '运行消融', projectId: project.id, scheduledDate: '2026-11-03', startTime: '15:00' })
  const create = () => new DesktopNotices(() => new SettingsRepository(db.db), () => repo.list(), () => false, () => {})
  let notices = create()
  try {
    notices.refreshTasks()
    vi.advanceTimersByTime(59_999); expect(notices.pending()).toEqual([])
    vi.advanceTimersByTime(1); expect(notices.pending()[0]).toMatchObject({ kind: 'task', detail: task.title })
    notices.stop(); notices = create(); notices.refreshTasks()
    const id = notices.pending()[0]!.id
    notices.acknowledge(id)
    notices.stop(); notices = create(); notices.refreshTasks()
    expect(notices.pending()).toEqual([])
    repo.update(task.id, { startTime: '15:10' }); notices.refreshTasks()
    vi.advanceTimersByTime(10 * 60_000); expect(notices.pending()).toHaveLength(1)
    vi.advanceTimersByTime(31 * 60_000); notices.refreshTasks()
    expect(notices.pending()).toHaveLength(1)
    repo.complete(task.id, true); notices.refreshTasks()
    expect(notices.pending()).toEqual([])
  } finally { notices.stop(); db.close() }
})
