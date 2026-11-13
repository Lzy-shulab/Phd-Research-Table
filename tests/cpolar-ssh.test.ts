import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cpolarSshEndpoint, cpolarSshInterval, updateSshConfig } from '../src/domain/cpolar-ssh'
import { CpolarSshSyncService } from '../src/main/widget/cpolar-ssh-sync'
import { GpuMonitorService } from '../src/main/widget/gpu-service'
import { parseCpolar } from '../src/domain/gpu'

const original = '# SSH 配置\r\nHost YunBensheng\r\n    HostName 40.tcp.vip.cpolar.cn # GPU\r\n    User ss\r\n    Port 13771\r\n    ForwardX11 yes\r\n    IdentityFile "C:\\Users\\研究员\\.ssh\\id_rsa"\r\n\r\nHost Chengyuan\r\n    HostName 10.tcp.cpolar.top\r\n    Port 11804\r\n'
const source = (port = '13963') => ({ checked_at: new Date().toISOString(), tunnels: [
  { id: 'another', name: 'YunComputer', url: 'tcp://other.cpolar.top:12955', protocol: 'tcp', status: 'online' },
  { id: 'target', name: 'ssh', url: `tcp://40.tcp.vip.cpolar.cn:${port}`, protocol: 'tcp', status: 'online' }
] })
const snapshot = (port?: string) => ({ ...parseCpolar(source(port)), updatedAt: new Date().toISOString() })
const active: Array<{ stop: () => void }> = []
const configFile = () => {
  const root = resolve('test-results/cpolar-ssh-unit'); mkdirSync(root, { recursive: true })
  const path = join(mkdtempSync(join(root, 'case-')), 'config'); writeFileSync(path, original)
  return path
}
afterEach(() => { active.splice(0).forEach(service => service.stop()); vi.useRealTimers() })

describe('Cpolar SSH synchronization', () => {
  it('changes only the requested host address and port, retaining comments, line endings and other options', () => {
    const expected = original.replace('40.tcp.vip.cpolar.cn # GPU', '41.tcp.vip.cpolar.cn # GPU').replace('13771', '13963')
    expect(updateSshConfig(original, { hostname: '41.tcp.vip.cpolar.cn', port: '13963' })).toBe(expected)
    expect(updateSshConfig(expected, { hostname: '41.tcp.vip.cpolar.cn', port: '13963' })).toBe(expected)
    expect(updateSshConfig('Host YunBensheng\n    User ss', { hostname: 'example.cpolar.cn', port: '12345' })).toContain('    Port 12345\n')
  })
  it('selects the named ssh tunnel and declines unavailable sources or an absent target host', () => {
    expect(cpolarSshEndpoint(snapshot())).toEqual({ hostname: '40.tcp.vip.cpolar.cn', port: '13963' })
    expect(() => cpolarSshEndpoint({ ...snapshot(), error: '同步失败' })).toThrow('同步失败')
    const offline = snapshot(); offline.tunnels[1]!.status = 'offline'
    expect(() => cpolarSshEndpoint(offline)).toThrow('暂未在线')
    expect(() => updateSshConfig('Host Chengyuan\n Port 11804\n', { hostname: 'example.cpolar.cn', port: '12345' })).toThrow('YunBensheng')
  })
  it('retains the stable server identity when the Cpolar address changes', () => {
    const pinned = original.replace('    User ss', '    HostKeyAlias YunBensheng\r\n    User ss')
    expect(updateSshConfig(pinned, { hostname: '41.tcp.vip.cpolar.cn', port: '14001' }))
      .toBe(pinned.replace('40.tcp.vip.cpolar.cn # GPU', '41.tcp.vip.cpolar.cn # GPU').replace('13771', '14001'))
  })
  it('backs up the original once, shares manual requests, and runs every five hours after startup', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T08:00:00Z'))
    const path = configFile(), read = vi.fn(async () => snapshot())
    const service = new CpolarSshSyncService(path, read, () => {}); active.push(service)
    service.start(); await service.refresh()
    expect(read).toHaveBeenCalledTimes(1)
    expect(readFileSync(path, 'utf8')).toBe(original.replace('13771', '13963'))
    expect(readFileSync(path + '.cpolar-backup', 'utf8')).toBe(original)
    read.mockImplementation(async () => snapshot('14001'))
    await vi.advanceTimersByTimeAsync(cpolarSshInterval - 1)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(2)
    expect(readFileSync(path, 'utf8')).toBe(original.replace('13771', '14001'))
    await Promise.all([service.refresh(), service.refresh()])
    expect(read).toHaveBeenCalledTimes(3)
    expect(service.snapshot().result).toBe('unchanged')
    expect(readFileSync(path + '.cpolar-backup', 'utf8')).toBe(original)
  })
  it('keeps the config on connection failure, then resumes using a new address', async () => {
    vi.useFakeTimers()
    const path = configFile(), read = vi.fn(async () => snapshot())
    read.mockRejectedValueOnce(new Error('LOGIN_REQUIRED'))
    const service = new CpolarSshSyncService(path, read, () => {}); active.push(service)
    service.start(); await service.refresh()
    expect(readFileSync(path, 'utf8')).toBe(original)
    expect(service.snapshot().error).toContain('登录')
    // Wall time advances while the machine is asleep; resume checks whether a refresh is due.
    vi.setSystemTime(Date.now() + cpolarSshInterval + 1000)
    service.checkDue(); await service.refresh()
    expect(readFileSync(path, 'utf8')).toBe(original.replace('13771', '13963'))
    expect(service.snapshot()).toMatchObject({ error: null, result: 'updated' })
  })
  it('manual synchronization reads Cpolar afresh even while the monitor has a cached snapshot', async () => {
    let port = '13963'
    const request = vi.fn(async () => new Response(JSON.stringify(source(port))))
    const monitor = new GpuMonitorService(request as typeof fetch, () => {}); active.push(monitor)
    await monitor.readCpolar()
    port = '14001'
    const path = configFile(), service = new CpolarSshSyncService(path, () => monitor.readCpolar(true), () => {}); active.push(service)
    await service.refresh()
    expect(request).toHaveBeenCalledTimes(2)
    expect(readFileSync(path, 'utf8')).toBe(original.replace('13771', '14001'))
    request.mockRejectedValueOnce(new Error('offline'))
    await service.refresh()
    expect(readFileSync(path, 'utf8')).toBe(original.replace('13771', '14001'))
    expect(service.snapshot().error).toBe('offline')
  })
  it('manual synchronization waits for an automatic sync and writes a newly queried address', async () => {
    let finishAutomatic!: (value: ReturnType<typeof snapshot>) => void
    const read = vi.fn(async () => snapshot('14001'))
      .mockImplementationOnce(() => new Promise(resolve => { finishAutomatic = resolve }))
    const path = configFile(), service = new CpolarSshSyncService(path, read, () => {}); active.push(service)
    const automatic = service.refresh(), manual = service.refresh(true), shared = service.refresh(true)
    finishAutomatic(snapshot()); await automatic
    await Promise.all([manual, shared])
    expect(read).toHaveBeenCalledTimes(2)
    expect(readFileSync(path, 'utf8')).toBe(original.replace('13771', '14001'))
    expect(service.snapshot()).toMatchObject({ address: '40.tcp.vip.cpolar.cn:14001', error: null })
  })
})
