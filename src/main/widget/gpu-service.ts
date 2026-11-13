import { emptyGpuSnapshot, gpuMonitorOrigin, type GpuMonitorSnapshot } from '../../shared/gpu'
import { parseCpolar, parseGpuStatus, parseLiveGpuStatus } from '../../domain/gpu'
import { DomainError } from '../../domain/errors'
import { z } from 'zod'

export class GpuMonitorService {
  private data: GpuMonitorSnapshot = structuredClone(emptyGpuSnapshot)
  private pending: Promise<GpuMonitorSnapshot> | null = null
  private refreshPending: Promise<GpuMonitorSnapshot> | null = null
  private cpolarPending: Promise<GpuMonitorSnapshot['cpolar']> | null = null
  private cpolarRefreshPending: Promise<GpuMonitorSnapshot['cpolar']> | null = null
  private ownerPending: Promise<GpuMonitorSnapshot> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  constructor(private readonly request: typeof fetch, private readonly changed: (snapshot: GpuMonitorSnapshot) => void,
    private readonly collectLive: () => Promise<unknown> = async () => { throw new Error('未配置 GPU 实时采集连接。') }) {}
  snapshot() { return this.data }
  setOwners(deviceId: string, names: string[]): Promise<GpuMonitorSnapshot> {
    if (this.ownerPending) throw new DomainError('UNAVAILABLE', '正在保存使用人，请稍候。')
    this.ownerPending = (async () => {
      // Finish an earlier poll before saving; subsequent polls share this operation.
      const polling = this.refreshPending ?? this.pending
      if (polling) await polling
      const server = this.data.servers.find(server => server.devices.some(gpu => gpu.id === deviceId))
      const gpu = server?.devices.find(gpu => gpu.id === deviceId)
      if (!server || !gpu) throw new DomainError('NOT_FOUND', 'GPU 已更新，请刷新后重新选择。')
      if (names.some(name => !this.data.teamMembers.includes(name))) throw new DomainError('VALIDATION', '团队成员已更新，请刷新后重新选择。')
      try {
        const response = await this.request(gpuMonitorOrigin + '/api/usage', {
          method: 'POST', credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000),
          headers: { 'Content-Type': 'application/json', Origin: gpuMonitorOrigin },
          body: JSON.stringify({ server_id: server.id, gpu_key: gpu.key, user_names: names })
        })
        if (response.status === 401) {
          this.data = { ...this.data, auth: 'required' }; this.changed(this.data)
          throw new DomainError('FORBIDDEN', '登录已过期，请登录 GPU 看板后重试。')
        }
        const result: unknown = await response.json()
        if (!response.ok) {
          const detail = z.object({ error: z.string().optional() }).safeParse(result)
          throw new DomainError('UNAVAILABLE', detail.success && detail.data.error || '使用人保存失败，请重试。')
        }
        const saved = z.object({ user_names: z.array(z.string()) }).parse(result).user_names
        this.data = { ...this.data, servers: this.data.servers.map(item => ({ ...item,
          devices: item.devices.map(device => device.id === deviceId ? { ...device, owners: saved } : device) })) }
        this.changed(this.data)
        return this.data
      } catch (error) {
        if (error instanceof DomainError) throw error
        throw new DomainError('UNAVAILABLE', error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
          ? '保存超时，请重试。' : '暂时无法保存使用人，请检查连接后重试。')
      }
    })().finally(() => { this.ownerPending = null; this.schedule() })
    return this.ownerPending
  }
  readCpolar(force = false): Promise<GpuMonitorSnapshot['cpolar']> {
    if (force) {
      if (!this.cpolarRefreshPending) this.cpolarRefreshPending = (async () => {
        // A manual refresh must not reuse a request started before the click.
        if (this.cpolarPending) await this.cpolarPending.catch(() => {})
        return this.fetchCpolar(true)
      })().finally(() => { this.cpolarRefreshPending = null })
      return this.cpolarRefreshPending
    }
    if (this.cpolarRefreshPending) return this.cpolarRefreshPending
    if (this.cpolarPending) return this.cpolarPending
    return this.fetchCpolar(false)
  }
  private fetchCpolar(force: boolean): Promise<GpuMonitorSnapshot['cpolar']> {
    this.cpolarPending = this.json(force ? '/api/cpolar/refresh' : '/api/cpolar', force
      ? { method: 'POST', headers: { Origin: gpuMonitorOrigin }, signal: AbortSignal.timeout(40000) } : {})
      .then(parseCpolar).then(cpolar => {
        this.data = { ...this.data, cpolar: { ...cpolar, updatedAt: new Date().toISOString() } }
        return this.data.cpolar
      }).catch(error => {
      const loginRequired = error instanceof Error && error.message === 'LOGIN_REQUIRED'
      this.data = { ...this.data, ...(loginRequired ? { auth: 'required' as const } : {}),
        cpolar: { ...this.data.cpolar, error: loginRequired ? null : this.data.cpolar.updatedAt ? '连接失败，保留上次地址' : '暂时无法读取 Cpolar 地址',
          tunnels: this.data.cpolar.tunnels.map(tunnel => ({ ...tunnel, status: 'unknown' as const })) } }
      throw error
    }).finally(() => { this.cpolarPending = null; this.changed(this.data) })
    return this.cpolarPending
  }
  private async json(path: string, options: RequestInit = {}) {
    const response = await this.request(gpuMonitorOrigin + path, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000), ...options })
    if (response.status === 401 || response.status === 403) throw new Error('LOGIN_REQUIRED')
    if (!response.ok) throw new Error('看板暂时无法连接')
    return response.json() as Promise<unknown>
  }
  async read(force = false): Promise<GpuMonitorSnapshot> {
    if (force) {
      if (!this.refreshPending) this.refreshPending = (async () => {
        // Finish earlier polling/saving, then fetch a new snapshot for this click.
        if (this.ownerPending) await this.ownerPending
        if (this.pending) await this.pending
        return this.poll(true)
      })().finally(() => { this.refreshPending = null })
      return this.refreshPending
    }
    if (this.ownerPending) return this.ownerPending
    if (this.refreshPending) return this.refreshPending
    if (this.pending) return this.pending
    if (this.data.updatedAt && Date.now() - Date.parse(this.data.updatedAt) < 60_000) return this.data
    return this.poll(false)
  }
  async reconnect(): Promise<GpuMonitorSnapshot> {
    await (this.ownerPending ?? this.refreshPending ?? this.pending)
    return this.pending ?? this.poll(false)
  }
  private poll(force: boolean): Promise<GpuMonitorSnapshot> {
    this.pending = (async () => {
      let loginRequired = false
      await Promise.all([
        (force ? Promise.all([this.json('/api/status'), this.collectLive()]).then(([source, live]) => parseLiveGpuStatus(source, live))
          : this.json('/api/status').then(parseGpuStatus)).then(status => { this.data = { ...this.data, ...status, auth: 'ready', updatedAt: new Date().toISOString(), error: null } })
          .catch(error => {
            loginRequired ||= error instanceof Error && error.message === 'LOGIN_REQUIRED'
            this.data = { ...this.data, idle: 0, busy: 0, unknown: this.data.total,
              servers: this.data.servers.map(server => ({ ...server, fresh: false, devices: server.devices.map(gpu => ({ ...gpu, state: 'unknown' as const })) })),
              error: loginRequired ? null : force ? error instanceof Error ? error.message : '实时采集失败，请重试。'
                : this.data.updatedAt ? '暂未更新，显示上次快照' : '暂时无法连接看板' }
          }),
        (force || this.data.cpolar.updatedAt && Date.now() - Date.parse(this.data.cpolar.updatedAt) < 300_000 ? Promise.resolve() :
          this.readCpolar()
            .catch(error => {
              loginRequired ||= error instanceof Error && error.message === 'LOGIN_REQUIRED'
              this.data = { ...this.data, cpolar: { ...this.data.cpolar, error: loginRequired ? null : this.data.cpolar.updatedAt ? '连接失败，保留上次地址' : '暂时无法读取 Cpolar 地址',
                tunnels: this.data.cpolar.tunnels.map(tunnel => ({ ...tunnel, status: 'unknown' as const })) } }
            }))
      ])
      if (loginRequired) this.data = { ...this.data, auth: 'required' }
      this.changed(this.data)
      this.schedule()
      return this.data
    })().finally(() => { this.pending = null })
    return this.pending
  }
  private schedule() {
    clearTimeout(this.timer)
    if (!this.stopped && this.data.auth !== 'required') { this.timer = setTimeout(() => { void this.read().catch(() => {}) }, 60_000); this.timer.unref() }
  }
  stop() { this.stopped = true; clearTimeout(this.timer) }
}
