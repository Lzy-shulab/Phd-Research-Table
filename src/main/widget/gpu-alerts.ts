import { Notification } from 'electron'
import { z } from 'zod'
import type { GpuMonitorSnapshot } from '../../shared/gpu'
import type { DesktopNotice } from '../../shared/widget'

const preferences = z.object({ enabled: z.boolean(), states: z.record(z.string(), z.enum(['busy', 'idle'])) })
interface AlertStore { getGpuAlerts(): unknown; setGpuAlerts(value: unknown): void }
export class GpuIdleAlerts {
  private notifications = new Set<Notification>()
  private error: string | null = null
  constructor(private readonly store: () => AlertStore, private readonly open: () => void, private readonly changed: () => void,
    private readonly publish: (notice: DesktopNotice) => void = () => {}) {}
  private read() { return preferences.safeParse(this.store().getGpuAlerts()).data ?? { enabled: true, states: {} } }
  settings() { return { enabled: this.read().enabled, available: Notification.isSupported() && process.env.WORKBENCH_DISABLE_NOTIFICATIONS !== '1', error: this.error } }
  setEnabled(enabled: boolean) { this.store().setGpuAlerts({ ...this.read(), enabled }); this.error = null }
  observe(snapshot: GpuMonitorSnapshot) {
    if (snapshot.auth !== 'ready' || snapshot.error) return
    const saved = this.read(), states = { ...saved.states }
    let changed = false
    for (const server of snapshot.servers) for (const gpu of server.devices) {
      if (gpu.state === 'unknown') continue
      const previous = states[gpu.id]
      if (previous === gpu.state) continue
      states[gpu.id] = gpu.state; changed = true
      if (previous !== 'busy' || gpu.state !== 'idle' || !saved.enabled) continue
      const free = gpu.memoryTotalMb !== null && gpu.memoryUsedMb !== null ? ` · 可用显存 ${((gpu.memoryTotalMb - gpu.memoryUsedMb) / 1024).toFixed(1)} GiB` : ''
      const title = `GPU ${gpu.index} 已空闲`, detail = `${server.name} · ${gpu.name}${free}`
      this.publish({ id: `gpu:${gpu.id}:${Date.now()}`, kind: 'gpu', title, detail, at: Date.now() })
      if (!this.settings().available) continue
      const notification = new Notification({ title, body: detail, silent: false })
      this.notifications.add(notification)
      notification.on('click', this.open)
      notification.on('close', () => this.notifications.delete(notification))
      notification.on('failed', () => { this.notifications.delete(notification); this.error = '系统通知未能送达'; this.changed() })
      notification.show()
    }
    if (changed) this.store().setGpuAlerts({ ...saved, states })
  }
  stop() { for (const notification of this.notifications) notification.close(); this.notifications.clear() }
}
