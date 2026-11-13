import { z } from 'zod'
import type { DesktopNotice } from '../../shared/widget'
import type { Task } from '../../shared/types'
import { readTaskReminder, taskReminderMinutes } from '../../domain/desktop-tasks'
import { localDay } from '../../shared/arxiv'
import type { SettingsRepository } from '../database/repositories/settings'

const notice = z.object({ id: z.string(), kind: z.enum(['checkin', 'gpu', 'cpolar', 'task']), title: z.string(), detail: z.string(), at: z.number() })
const storage = z.object({ events: z.array(notice), receipts: z.record(z.string(), z.number()) })
const receiptLifetime = 31 * 86_400_000

export class DesktopNotices {
  private checkins: DesktopNotice[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly settings: () => SettingsRepository, private readonly readTasks: () => Task[],
    private readonly paused: () => boolean, private readonly changed: (reveal: boolean) => void) {}

  private read() { return storage.safeParse(this.settings().getDesktopNotices()).data ?? { events: [], receipts: {} as Record<string, number> } }

  pending(): DesktopNotice[] {
    const { events, receipts } = this.read()
    return [...this.checkins, ...events].filter(item => !(item.id in receipts)).sort((a, b) => a.at - b.at)
  }

  setCheckins(items: DesktopNotice[]) {
    const receipts = this.read().receipts
    const reveal = items.some(item => !this.checkins.some(old => old.id === item.id) && !(item.id in receipts))
    this.checkins = items
    this.changed(reveal)
  }

  publish(item: DesktopNotice) {
    if (this.paused()) return
    const saved = this.read()
    this.settings().setDesktopNotices({ ...saved, events: [...saved.events.filter(old => old.id !== item.id), item] })
    this.changed(true)
  }

  acknowledge(id: string) {
    const saved = this.read()
    const event = saved.events.find(item => item.id === id)
    const scheduled = event?.kind === 'task' || this.checkins.some(item => item.id === id)
    if (!event && !scheduled) return
    const receipts = scheduled ? { ...Object.fromEntries(Object.entries(saved.receipts).filter(([, at]) => Date.now() - at < receiptLifetime)), [id]: Date.now() } : saved.receipts
    this.settings().setDesktopNotices({ events: saved.events.filter(item => item.id !== id), receipts })
    this.changed(false)
  }

  refreshTasks = () => {
    clearTimeout(this.timer)
    if (this.paused()) return
    const saved = this.read()
    const previous = saved.events.filter(item => item.kind === 'task')
    const now = Date.now(), today = localDay(new Date(now)), nextItems: DesktopNotice[] = []
    let next = Infinity
    for (const task of this.readTasks()) {
      if (task.status === 'completed' || !task.scheduledDate || !task.startTime || (task.deferredUntil && task.deferredUntil > task.scheduledDate)) continue
      const start = new Date(`${task.scheduledDate}T${task.startTime}:00`).getTime()
      const id = `task:${task.id}:${start}`
      const due = start - taskReminderMinutes(task) * 60_000
      if (due > now) next = Math.min(next, due)
      else if (!(id in saved.receipts) && (task.scheduledDate >= today || previous.some(item => item.id === id))) {
        const day = task.scheduledDate === today ? '' : `${task.scheduledDate.slice(5)} `
        nextItems.push({ id, kind: 'task', title: `${day}${task.startTime} ${start <= now ? '已到时间' : '开始'}`, detail: readTaskReminder(task.title).title, at: due })
        if (start > now) next = Math.min(next, start)
      }
    }
    if (JSON.stringify(nextItems) !== JSON.stringify(previous)) {
      this.settings().setDesktopNotices({ ...saved, events: [...saved.events.filter(item => item.kind !== 'task'), ...nextItems] })
      this.changed(nextItems.some(item => !previous.some(old => old.id === item.id)))
    }
    if (Number.isFinite(next)) this.timer = setTimeout(this.refreshTasks, Math.min(2_147_483_647, Math.max(1, next - now))).unref()
  }

  stop() { clearTimeout(this.timer) }
}
