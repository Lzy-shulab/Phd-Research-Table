import { Notification, type BrowserWindow } from 'electron'
import type { DatabaseConnection } from '../database/db'
import { LibraryRepository } from '../database/repositories/library'
import { SubmissionRepository } from '../database/repositories/submissions'
import { revisionReminder } from '../../shared/submissions'
import { localDay } from '../../shared/arxiv'

export class SubmissionReminders {
  private timer: ReturnType<typeof setInterval> | undefined
  private error = ''
  private stopped = false
  private notifications = new Set<Notification>()
  constructor(private readonly connection: () => DatabaseConnection, private readonly window: () => BrowserWindow | null,
    private readonly paused: () => boolean, private readonly changed: () => void) {}
  snapshot() { return { notificationsSupported: Notification.isSupported() && process.env.WORKBENCH_DISABLE_NOTIFICATIONS !== '1', notificationError: this.error } }
  start() {
    if (this.timer || this.stopped) return
    this.timer = setInterval(() => this.check(), 60_000); this.timer.unref()
    this.check()
  }
  check(now = new Date()) {
    if (this.paused() || this.stopped || !this.snapshot().notificationsSupported) return
    try {
      const connection = this.connection(), repo = new SubmissionRepository(connection.db), settings = new LibraryRepository(connection.db)
      const today = localDay(now)
      for (const submission of repo.list()) {
        const reminder = revisionReminder(submission, today)
        if (!reminder) continue
        const key = `submission.reminder.${submission.id}`
        const stamp = `${submission.revisionDueDate}:${today}`
        if (settings.setting(key, '') === stamp) continue
        const notification = new Notification({ title: reminder.label, body: `${submission.title}\n${submission.journal} · 截止 ${submission.revisionDueDate}`,
          silent: false, timeoutType: 'never' })
        this.notifications.add(notification)
        notification.on('click', () => {
          const window = this.window()
          if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); window.webContents.send('submission:open') }
        })
        notification.on('failed', (_event, error) => { this.error = `系统通知未能送达：${error}。到期事项仍会在投稿页面显示。`; this.notifications.delete(notification); this.changed() })
        notification.on('close', () => this.notifications.delete(notification))
        notification.show()
        settings.setSetting(key, stamp)
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : '系统提醒暂时不可用，投稿页面仍会显示到期事项。'
      this.changed()
    }
  }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); for (const notification of this.notifications) notification.close(); this.notifications.clear() }
}
