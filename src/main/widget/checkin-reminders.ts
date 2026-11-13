import { Notification } from 'electron'
import type { DatabaseConnection } from '../database/db'
import { ReportsRepository } from '../database/repositories/reports'
import { LibraryRepository } from '../database/repositories/library'
import { checkinReminderAt, isOpenCheckin } from '../../domain/reports'
import type { DesktopNotice } from '../../shared/widget'

// The planned reminder is independent of the actual end of an open check-in.
export class CheckinReminders {
  private timer: ReturnType<typeof setTimeout> | undefined
  private notifications = new Set<Notification>()
  private stopped = false
  constructor(private readonly connection: () => DatabaseConnection, private readonly paused: () => boolean, private readonly openCheckin: () => void,
    private readonly publish: (items: DesktopNotice[]) => void = () => {}) {}
  refresh = () => {
    clearTimeout(this.timer)
    if (this.stopped || this.paused()) return
    const db = this.connection().db, settings = new LibraryRepository(db)
    const entries = new ReportsRepository(db).snapshot().checkins
    const notified: Record<string, number> = JSON.parse(settings.setting('research.checkin-reminders.v1', '{}'))
    const now = Date.now()
    const desktop: DesktopNotice[] = []
    const system = process.env.WORKBENCH_DISABLE_NOTIFICATIONS !== '1' && Notification.isSupported()
    let next = Infinity, changed = false
    for (const entry of entries) {
      const end = checkinReminderAt(entry), active = isOpenCheckin(entry)
      if (end === null || (!active && now - end >= 86_400_000)) continue
      if (end > now) { next = Math.min(next, end); continue }
      if (!active) next = Math.min(next, end + 86_400_000)
      const title = active ? '打卡已满 12 小时' : '到下班时间了'
      const detail = active ? '记得结束打卡' : `计划 ${entry.endTime} 下班`
      desktop.push({ id: `checkin:${entry.id}:${end}`, kind: 'checkin', title, detail, at: end })
      if (!system || notified[entry.id] === end || now - end > 86_400_000) continue
      const notification = new Notification({ title, body: detail, silent: false })
      this.notifications.add(notification)
      notification.on('click', this.openCheckin)
      notification.on('close', () => this.notifications.delete(notification))
      notification.on('failed', () => this.notifications.delete(notification))
      notification.show()
      notified[entry.id] = end; changed = true
    }
    this.publish(desktop)
    if (changed) settings.setSetting('research.checkin-reminders.v1', JSON.stringify(notified))
    if (Number.isFinite(next)) {
      this.timer = setTimeout(this.refresh, Math.min(2_147_483_647, Math.max(1, next - now)))
      this.timer.unref()
    }
  }
  stop() { this.stopped = true; clearTimeout(this.timer); for (const n of this.notifications) n.close(); this.notifications.clear() }
}
