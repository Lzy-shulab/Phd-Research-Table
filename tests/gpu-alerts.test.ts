import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { emptyGpuSnapshot, type GpuMonitorSnapshot, type GpuAvailability } from '../src/shared/gpu'

const delivered = vi.hoisted(() => [] as { title: string; body: string }[])
vi.mock('electron', () => ({ Notification: class extends EventEmitter {
  static isSupported() { return true }
  constructor(private options: { title: string; body: string }) { super() }
  show() { delivered.push(this.options) }
  close() { this.emit('close') }
} }))
import { GpuIdleAlerts } from '../src/main/widget/gpu-alerts'

const snapshot = (...states: GpuAvailability[]): GpuMonitorSnapshot => ({ ...structuredClone(emptyGpuSnapshot), auth: 'ready', updatedAt: new Date().toISOString(),
  total: states.length, servers: [{ id: 'server', name: 'Compute', fresh: true, collectedAt: new Date().toISOString(), warning: '',
    devices: states.map((state, index) => ({ id: `server:gpu-${index}`, index, name: 'RTX A6000', state, utilization: state === 'busy' ? 90 : 0,
      memoryUsedMb: 0, memoryTotalMb: 49152, key: `index:${index}`, owners: [], workloads: state === 'busy' ? 1 : 0 })) }] })
let saved: unknown
const store = { getGpuAlerts: () => saved, setGpuAlerts: (value: unknown) => { saved = value } }
let alerts: GpuIdleAlerts
beforeEach(() => { saved = undefined; delivered.length = 0; vi.stubEnv('WORKBENCH_DISABLE_NOTIFICATIONS', '0'); alerts = new GpuIdleAlerts(() => store, () => {}, () => {}) })
afterEach(() => { alerts.stop(); vi.unstubAllEnvs() })
describe('GPU idle notifications', () => {
  it('notifies on a confirmed busy-to-idle transition once per card, then re-arms after a new workload', () => {
    alerts.observe(snapshot('busy', 'idle')); expect(delivered).toHaveLength(0)
    alerts.observe(snapshot('idle', 'idle')); expect(delivered).toHaveLength(1)
    expect(delivered[0]?.title).toBe('GPU 0 已空闲')
    alerts.observe(snapshot('idle', 'idle')); alerts.observe(snapshot('unknown', 'idle')); alerts.observe(snapshot('idle', 'idle'))
    expect(delivered).toHaveLength(1)
    alerts.observe(snapshot('busy', 'busy')); alerts.observe(snapshot('idle', 'idle'))
    expect(delivered).toHaveLength(3)
  })
  it('preserves the last reliable state across restart without repeating an existing idle reminder', () => {
    alerts.observe(snapshot('busy')); alerts.observe(snapshot('idle')); alerts.stop()
    alerts = new GpuIdleAlerts(() => store, () => {}, () => {})
    alerts.observe(snapshot('idle')); expect(delivered).toHaveLength(1)
    alerts.observe({ ...snapshot('busy'), error: '连接失败' }); alerts.observe(snapshot('idle'))
    expect(delivered).toHaveLength(1)
  })
  it('saves the switch and consumes transitions while disabled instead of notifying retroactively', () => {
    alerts.observe(snapshot('busy')); alerts.setEnabled(false); alerts.observe(snapshot('idle'))
    expect(alerts.settings().enabled).toBe(false); expect(delivered).toHaveLength(0)
    alerts.setEnabled(true); alerts.observe(snapshot('idle')); expect(delivered).toHaveLength(0)
    alerts.observe(snapshot('busy')); alerts.observe(snapshot('idle')); expect(delivered).toHaveLength(1)
  })
})
