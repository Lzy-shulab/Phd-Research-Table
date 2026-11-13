import { constants, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { cpolarSshEndpoint, cpolarSshHost, cpolarSshInterval, updateSshConfig } from '../../domain/cpolar-ssh'
import type { CpolarSshSyncSnapshot, GpuMonitorSnapshot } from '../../shared/gpu'

export class CpolarSshSyncService {
  private data: CpolarSshSyncSnapshot
  private pending: Promise<CpolarSshSyncSnapshot> | null = null
  private refreshPending: Promise<CpolarSshSyncSnapshot> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = true
  constructor(private readonly configPath: string, private readonly readSource: () => Promise<GpuMonitorSnapshot['cpolar']>,
    private readonly changed: () => void, private readonly automaticResult: (state: CpolarSshSyncSnapshot) => void = () => {}) {
    this.data = { host: cpolarSshHost, configPath, syncing: false, checkedAt: null, syncedAt: null,
      nextCheckAt: null, address: null, result: null, error: null }
  }
  snapshot() { return this.data }
  start() { this.stopped = false; this.runAutomatic() }
  checkDue() { if (!this.stopped && (!this.data.nextCheckAt || Date.now() >= Date.parse(this.data.nextCheckAt))) this.runAutomatic() }
  private runAutomatic() { void this.refresh().then(this.automaticResult) }
  refresh(force = false): Promise<CpolarSshSyncSnapshot> {
    if (force) {
      if (!this.refreshPending) this.refreshPending = (async () => {
        if (this.pending) await this.pending
        return this.synchronize()
      })().finally(() => { this.refreshPending = null })
      return this.refreshPending
    }
    if (this.refreshPending) return this.refreshPending
    if (this.pending) return this.pending
    return this.synchronize()
  }
  private synchronize(): Promise<CpolarSshSyncSnapshot> {
    clearTimeout(this.timer)
    this.data = { ...this.data, syncing: true, error: null }
    this.changed()
    this.pending = (async () => {
      try {
        const endpoint = cpolarSshEndpoint(await this.readSource())
        const before = readFileSync(this.configPath, 'utf8')
        const after = updateSshConfig(before, endpoint)
        if (after !== before) {
          try { copyFileSync(this.configPath, `${this.configPath}.cpolar-backup`, constants.COPYFILE_EXCL) }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
          writeFileSync(this.configPath, after, 'utf8')
        }
        this.data = { ...this.data, syncedAt: new Date().toISOString(), address: `${endpoint.hostname}:${endpoint.port}`,
          result: after === before ? 'unchanged' : 'updated' }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        this.data = { ...this.data, result: null, error: code === 'ENOENT' ? '未找到 SSH 配置文件，请检查文件位置。'
          : code === 'EACCES' || code === 'EPERM' ? '无法写入 SSH 配置，请检查文件权限后重试。'
          : error instanceof Error && error.message === 'LOGIN_REQUIRED' ? '请登录 GPU 看板后更新 SSH。'
          : error instanceof Error ? error.message : 'SSH 更新失败，请重试。' }
      } finally {
        const now = Date.now()
        this.data = { ...this.data, syncing: false, checkedAt: new Date(now).toISOString(), nextCheckAt: new Date(now + cpolarSshInterval).toISOString() }
        if (!this.stopped) { this.timer = setTimeout(() => this.runAutomatic(), cpolarSshInterval); this.timer.unref() }
        this.changed()
      }
      return this.data
    })().finally(() => { this.pending = null })
    return this.pending
  }
  stop() { this.stopped = true; clearTimeout(this.timer) }
}
