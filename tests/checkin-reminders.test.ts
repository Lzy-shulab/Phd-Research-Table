import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import { openDatabase, type DatabaseConnection } from '../src/main/database/db'
import { ReportsRepository } from '../src/main/database/repositories/reports'
import { suggestedCheckinEnd, checkinEndAt } from '../src/domain/reports'
import type { DesktopNotice } from '../src/shared/widget'

const delivered = vi.hoisted(() => [] as { title: string; body: string }[])
vi.mock('electron', () => ({ Notification: class extends EventEmitter {
  static isSupported() { return true }
  constructor(private options: { title: string; body: string }) { super() }
  show() { delivered.push(this.options) }
  close() { this.emit('close') }
} }))
import { CheckinReminders } from '../src/main/widget/checkin-reminders'

let connection: DatabaseConnection
let reminders: CheckinReminders
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T20:59:00'))
  vi.stubEnv('WORKBENCH_DISABLE_NOTIFICATIONS', '0')
  delivered.length = 0
  connection = openDatabase(':memory:', resolve('src/main/database/migrations'))
  reminders = new CheckinReminders(() => connection, () => false, () => {})
})
afterEach(() => { reminders.stop(); connection.close(); vi.useRealTimers(); vi.unstubAllEnvs() })
describe('checkin end times and reminders', () => {
  it('adds twelve hours and carries midnight into the next date', () => {
    expect(suggestedCheckinEnd('09:30')).toEqual({ endTime: '21:30', endsNextDay: false })
    expect(suggestedCheckinEnd('18:45')).toEqual({ endTime: '06:45', endsNextDay: true })
    expect(checkinEndAt({ date: '2026-11-03', endTime: '06:45', endsNextDay: true })).toBe(new Date('2026-11-04T06:45:00').getTime())
  })
  it('notifies once at the saved time and remembers delivery after restarting', () => {
    new ReportsRepository(connection.db).saveCheckin({ date: '2026-11-03', startTime: '09:00', endTime: '21:00', endsNextDay: false, notes: '', reminderEnabled: true })
    reminders.refresh(); vi.advanceTimersByTime(59_999); expect(delivered).toHaveLength(0)
    vi.advanceTimersByTime(1); expect(delivered).toHaveLength(1)
    reminders.stop(); reminders = new CheckinReminders(() => connection, () => false, () => {})
    reminders.refresh(); expect(delivered).toHaveLength(1)
  })
  it('reschedules edited times and cancels reminders for deleted entries', () => {
    const repo = new ReportsRepository(connection.db)
    const input = { date: '2026-11-03', startTime: '09:00', endTime: '21:00', endsNextDay: false, notes: '', reminderEnabled: true }
    const entry = repo.saveCheckin(input); reminders.refresh()
    repo.saveCheckin({ ...input, endTime: '21:15' }, entry.id); reminders.refresh()
    vi.advanceTimersByTime(60_000); expect(delivered).toHaveLength(0)
    repo.deleteCheckin(entry.id); reminders.refresh()
    vi.advanceTimersByTime(15 * 60_000); expect(delivered).toHaveLength(0)
  })
  it('catches up after sleep without notifying historical records', () => {
    const repo = new ReportsRepository(connection.db)
    repo.saveCheckin({ date: '2026-11-02', startTime: '09:00', endTime: '21:00', endsNextDay: false, notes: '' })
    repo.saveCheckin({ date: '2026-11-03', startTime: '09:00', endTime: '21:00', endsNextDay: false, notes: '', reminderEnabled: true })
    vi.setSystemTime(new Date('2026-11-03T21:10:00')); reminders.refresh()
    expect(delivered).toHaveLength(1)
  })
  it('shows an open check-in after 12 hours with system notifications disabled and counts the actual end', () => {
    vi.stubEnv('WORKBENCH_DISABLE_NOTIFICATIONS', '1')
    reminders.stop()
    let pending: DesktopNotice[] = []
    reminders = new CheckinReminders(() => connection, () => false, () => {}, items => { pending = items })
    const repo = new ReportsRepository(connection.db)
    const entry = repo.startCheckin({ date: '2026-11-03', startTime: '09:00', notes: '', reminderEnabled: true })
    expect(repo.snapshot().checkins[0]).toMatchObject({ durationMinutes: 0, startTime: '09:00' })
    reminders.refresh(); vi.advanceTimersByTime(59_999); expect(pending).toHaveLength(0)
    vi.advanceTimersByTime(1); expect(pending[0]?.title).toBe('打卡已满 12 小时')
    expect(delivered).toHaveLength(0)
    const closed = repo.saveCheckin({ date: entry.date, startTime: entry.startTime, endTime: '17:45', endsNextDay: false, notes: '' }, entry.id)
    reminders.refresh()
    expect(closed.durationMinutes).toBe(525)
    expect(pending).toHaveLength(0)
  })
})
