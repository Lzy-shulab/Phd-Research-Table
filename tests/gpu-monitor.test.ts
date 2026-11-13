import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseGpuStatus, parseCpolar, parseLiveGpuStatus } from '../src/domain/gpu'
import { GpuMonitorService } from '../src/main/widget/gpu-service'

const device = (index: number, changes = {}) => ({ index, name: 'NVIDIA RTX A6000', utilization: 0, memory_used_mb: 128,
  memory_total_mb: 49140, processes: [], user_names: [], ...changes })
const status = () => ({ server_now: '2026-11-03T09:00:30Z', stale_after_seconds: 90, servers: [
  { server_id: 'active', name: 'Compute', collected_at: '2026-11-03T09:00:10Z', received_at: '2026-11-03T09:00:12Z', gpus: [
    device(0, { processes: [{ command: '/usr/bin/Xorg', process_type: 'G' }] }),
    device(1, { utilization: 98, processes: [{ command: 'python train.py', process_type: 'C' }], user_names: ['研究员'] }),
    device(2, { processes: [{ command: 'python train.py', process_type: 'C', command_status: 'exited' }] })
  ] },
  { server_id: 'stale', name: 'Old snapshot', collected_at: '2026-11-03T08:00:00Z', received_at: '2026-11-03T08:00:01Z', gpus: [device(0)] }
] })
const tunnels = () => ({ checked_at: '2026-11-03T09:00:00Z', error: '', message: '', tunnels: [
  { id: 'ssh', name: 'SSH', url: 'tcp://example.cpolar.cn:12345', protocol: 'tcp', status: 'online', last_seen_at: '2026-11-03T09:00:00Z' },
  { id: 'web', name: 'Website', url: 'https://example.cpolar.top', protocol: 'https', status: 'offline', last_seen_at: '2026-11-02T09:00:00Z' }
] })
const services: GpuMonitorService[] = []
afterEach(() => { services.splice(0).forEach(service => service.stop()); vi.useRealTimers() })
describe('GPU monitor', () => {
  it('matches the dashboard workload rule and excludes stale devices from idle counts', () => {
    const parsed = parseGpuStatus(status())
    expect(parsed).toMatchObject({ total: 4, idle: 2, busy: 1, unknown: 1 })
    expect(parsed.servers[0]?.devices[1]).toMatchObject({ state: 'busy', utilization: 98, owners: ['研究员'], workloads: 1 })
    const failed = status(); failed.servers[0] = { ...failed.servers[0]!, warnings: ['无法读取进程列表'] } as typeof failed.servers[number]
    expect(parseGpuStatus(failed).unknown).toBe(4)
  })
  it('keeps last Cpolar addresses but marks their status unknown when upstream sync fails', () => {
    const parsed = parseCpolar({ ...tunnels(), error: '同步失败' })
    expect(parsed.tunnels.map(t => t.status)).toEqual(['unknown', 'unknown'])
    expect(parsed.tunnels[0]?.url).toBe('tcp://example.cpolar.cn:12345')
  })
  it('shares requests, refreshes GPU in the background, and caches Cpolar for five minutes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T09:00:30Z'))
    const request = vi.fn(async input => new Response(JSON.stringify(String(input).endsWith('/api/status') ? status() : tunnels())))
    const service = new GpuMonitorService(request as typeof fetch, () => {}); services.push(service)
    await Promise.all([service.read(), service.read()]); expect(request).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_001)
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/api/status'))).toHaveLength(2)
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/api/cpolar'))).toHaveLength(1)
  })
  it('manual refresh bypasses GPU snapshots and Cpolar refresh triggers the website live query', async () => {
    let utilization = 1
    const request = vi.fn(async (input: RequestInfo | URL) => {
      return Response.json(String(input).endsWith('/api/status') ? status() : tunnels())
    })
    const collect = vi.fn(async () => {
      const latest = status().servers[0]!; latest.gpus[0]!.utilization = utilization; return latest
    })
    const service = new GpuMonitorService(request as typeof fetch, () => {}, collect); services.push(service)
    await service.read(); utilization = 87
    expect((await service.read()).servers[0]?.devices[0]?.utilization).toBe(0)
    expect(collect).not.toHaveBeenCalled()
    expect((await service.read(true)).servers[0]?.devices[0]?.utilization).toBe(87)
    expect(request).toHaveBeenCalledTimes(3)
    expect(collect).toHaveBeenCalledTimes(1)
    await service.readCpolar(true)
    expect(request).toHaveBeenCalledTimes(4)
    expect(request).toHaveBeenLastCalledWith('https://shulab-gpu-monitor.netlify.app/api/cpolar/refresh',
      expect.objectContaining({ method: 'POST', cache: 'no-store', credentials: 'include', headers: { Origin: 'https://shulab-gpu-monitor.netlify.app' } }))
  })
  it('manual refresh waits for an earlier poll then reads again, sharing only the new refresh', async () => {
    let finishPoll!: (response: Response) => void
    let statusCalls = 0
    const request = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith('/api/status')) return Response.json(tunnels())
      if (++statusCalls === 1) return new Promise<Response>(resolve => { finishPoll = resolve })
      const latest = status(); latest.servers[0]!.gpus[0]!.utilization = 87
      return Response.json(latest)
    })
    const collect = vi.fn(async () => {
      const latest = status().servers[0]!; latest.gpus[0]!.utilization = 87; return latest
    })
    const service = new GpuMonitorService(request as typeof fetch, () => {}, collect); services.push(service)
    const background = service.read(), firstClick = service.read(true), secondClick = service.read(true)
    expect(statusCalls).toBe(1)
    finishPoll(Response.json(status())); await background
    for (const result of await Promise.all([firstClick, secondClick])) expect(result.servers[0]?.devices[0]?.utilization).toBe(87)
    expect(statusCalls).toBe(2)
    expect(collect).toHaveBeenCalledTimes(1)
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/api/cpolar/refresh'))).toHaveLength(0)
  })
  it('Cpolar live refresh does not reuse an earlier saved-address request', async () => {
    let finishRead!: (response: Response) => void
    const latest = tunnels(); latest.tunnels[0]!.url = 'tcp://latest.cpolar.cn:14001'
    const request = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/api/cpolar')
      ? new Promise<Response>(resolve => { finishRead = resolve }) : Response.json(latest))
    const service = new GpuMonitorService(request as typeof fetch, () => {}, async () => status().servers[0]); services.push(service)
    const background = service.readCpolar(), manual = service.readCpolar(true)
    expect(request).toHaveBeenCalledTimes(1)
    finishRead(Response.json(tunnels())); await background
    expect((await manual).tunnels[0]?.url).toBe('tcp://latest.cpolar.cn:14001')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('shows login expiry and network failure without reporting cached devices as free', async () => {
    let mode: 'ok' | 'offline' | 'login' = 'ok'
    const request = async (input: RequestInfo | URL) => {
      if (mode === 'offline') throw new Error('offline')
      return mode === 'login' ? new Response('{}', { status: 401 }) : new Response(JSON.stringify(String(input).endsWith('/api/status') ? status() : tunnels()))
    }
    const service = new GpuMonitorService(request as typeof fetch, () => {}, async () => status().servers[0]); services.push(service)
    expect((await service.read()).idle).toBe(2)
    mode = 'offline'; expect(await service.read(true)).toMatchObject({ idle: 0, busy: 0, unknown: 4, error: 'offline' })
    mode = 'login'; expect((await service.read(true)).auth).toBe('required')
    mode = 'ok'; expect(await service.read(true)).toMatchObject({ auth: 'ready', idle: 2, error: null })
  })
  it('keeps dashboard owners while replacing metrics and collection time with the on-demand result', () => {
    const live = status().servers[0]!
    live.collected_at = '2026-11-03T09:10:00Z'
    live.gpus[1]!.utilization = 53
    live.gpus[1]!.user_names = []
    const parsed = parseLiveGpuStatus(status(), live)
    expect(parsed.servers[0]).toMatchObject({ collectedAt: live.collected_at, fresh: true })
    expect(parsed.servers[0]?.devices[1]).toMatchObject({ utilization: 53, owners: ['研究员'] })
  })
  it('reports failed live collection instead of presenting the stored snapshot as a successful refresh', async () => {
    const request = async (input: RequestInfo | URL) => Response.json(String(input).endsWith('/api/status') ? status() : tunnels())
    const service = new GpuMonitorService(request as typeof fetch, () => {}, async () => { throw Error('实时采集失败，请检查 SSH 连接后重试。') }); services.push(service)
    const before = await service.read()
    expect(await service.read(true)).toMatchObject({ updatedAt: before.updatedAt, unknown: 4, error: '实时采集失败，请检查 SSH 连接后重试。' })
  })
})
