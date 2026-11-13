import { Notification } from 'electron'
import { z } from 'zod'
import type { SettingsRepository } from '../database/repositories/settings'

const interval = 30 * 60_000
const reminderSchema = z.object({ dueAt: z.number().int().positive(), notified: z.boolean() })

export class WaterReminder {
  private timer: ReturnType<typeof setTimeout> | undefined
  private notification: Notification | undefined
  private announcedDueAt: number | null = null

  constructor(
    private readonly settings: () => SettingsRepository,
    private readonly relocating: () => boolean,
    private readonly onDue: () => void,
    private readonly openCheckin: () => void
  ) {}

  private read() { return reminderSchema.safeParse(this.settings().getWaterReminder()).data }

  dueAt() { return this.read()?.dueAt ?? null }

  update(action: 'restart' | 'stop') {
    const next = action === 'restart' ? { dueAt: Date.now() + interval, notified: false } : null
    this.settings().setWaterReminder(next)
    this.stop()
    this.refresh()
  }

  refresh = () => {
    clearTimeout(this.timer)
    if (this.relocating()) {
      this.timer = setTimeout(this.refresh, 1000).unref()
      return
    }
    const reminder = this.read()
    if (!reminder) return
    const remaining = reminder.dueAt - Date.now()
    if (remaining > 0) {
      this.timer = setTimeout(this.refresh, remaining).unref()
      return
    }
    if (this.announcedDueAt !== reminder.dueAt) {
      this.announcedDueAt = reminder.dueAt
      this.onDue()
    }
    if (reminder.notified || process.env.WORKBENCH_DISABLE_NOTIFICATIONS === '1' || !Notification.isSupported()) return
    const notification = new Notification({ title: '该喝水了', body: '喝完后点桌面便签旁的「已喝」，开始下一轮 30 分钟。' })
    this.settings().setWaterReminder({ ...reminder, notified: true })
    this.notification = notification
    notification.on('click', this.openCheckin)
    notification.show()
  }

  stop() {
    clearTimeout(this.timer)
    this.notification?.close()
    this.notification = undefined
  }
}
