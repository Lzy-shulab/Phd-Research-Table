import { afterEach, describe, expect, it, vi } from 'vitest'
import { gpuOwnersInputSchema } from '../src/domain/gpu'
import { GpuMonitorService } from '../src/main/widget/gpu-service'

const status = (uuid?: string) => ({ server_now: new Date().toISOString(), team_members: ['研究员', '同事'], servers: [
  { server_id: 'compute', name: 'Compute', collected_at: new Date().toISOString(), received_at: new Date().toISOString(),
    gpus: [{ index: 0, uuid, name: 'NVIDIA RTX A6000', utilization: 0, user_names: ['研究员'] }] }
] })
const services: GpuMonitorService[] = []
const create = (request: typeof fetch) => { const service = new GpuMonitorService(request, () => {}, async () => status().servers[0]); services.push(service); return service }
afterEach(() => { services.splice(0).forEach(service => service.stop()) })

describe('GPU owner sync', () => {
  it('writes multiple owners with the website identifiers and reads later website changes back', async () => {
    const source = status('GPU-a6000')
    const posts: RequestInit[] = []
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/usage') && init?.method === 'POST') {
        expect(String(input)).toBe('https://shulab-gpu-monitor.netlify.app/api/usage')
        posts.push(init); return Response.json({ user_names: ['同事', '研究员'] })
      }
      return Response.json(String(input).endsWith('/api/status') ? source : { tunnels: [] })
    })
    const service = create(request as typeof fetch)
    await service.read()
    expect(service.snapshot().teamMembers).toEqual(['研究员', '同事'])
    const saved = await service.setOwners('compute:GPU-a6000', ['研究员', '同事'])
    expect(posts[0]).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Origin: 'https://shulab-gpu-monitor.netlify.app' } })
    expect(JSON.parse(posts[0]!.body as string)).toEqual({ server_id: 'compute', gpu_key: 'GPU-a6000', user_names: ['研究员', '同事'] })
    expect(saved.servers[0]?.devices[0]?.owners).toEqual(['同事', '研究员'])
    source.servers[0]!.gpus[0]!.user_names = ['同事']
    await service.read(true)
    expect(service.snapshot().servers[0]?.devices[0]?.owners).toEqual(['同事'])
  })
  it('clears owners using the website index key when UUID is absent', async () => {
    let posted: unknown
    const request = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/usage') && init?.method === 'POST') { posted = JSON.parse(init.body as string); return Response.json({ user_names: [] }) }
      return Response.json(String(input).endsWith('/api/status') ? status() : { tunnels: [] })
    }
    const service = create(request as typeof fetch)
    await service.read(); await service.setOwners('compute:0', [])
    expect(posted).toEqual({ server_id: 'compute', gpu_key: 'index:0', user_names: [] })
    expect(service.snapshot().servers[0]?.devices[0]?.owners).toEqual([])
    expect(gpuOwnersInputSchema.parse({ deviceId: 'compute:0', names: ['研究员', '研究员'] }).names).toEqual(['研究员'])
  })
  it('keeps saved owners on write failure and reports an expired login', async () => {
    let code = 503
    const request = async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/api/usage') && init?.method === 'POST'
      ? Response.json({ error: '暂时无法保存，请稍后重试。' }, { status: code })
      : Response.json(String(input).endsWith('/api/status') ? status() : { tunnels: [] })
    const service = create(request as typeof fetch)
    await service.read()
    await expect(service.setOwners('compute:0', ['同事'])).rejects.toThrow('暂时无法保存，请稍后重试。')
    expect(service.snapshot().servers[0]?.devices[0]?.owners).toEqual(['研究员'])
    code = 401
    await expect(service.setOwners('compute:0', [])).rejects.toThrow('登录已过期')
    expect(service.snapshot().auth).toBe('required')
    expect(service.snapshot().servers[0]?.devices[0]?.owners).toEqual(['研究员'])
  })
  it('serializes polling and saving so an older response cannot undo a save', async () => {
    let releasePoll!: (response: Response) => void, releaseSave!: (response: Response) => void
    let holdPoll = false
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/usage') && init?.method === 'POST') return new Promise<Response>(resolve => { releaseSave = resolve })
      if (String(input).endsWith('/api/status') && holdPoll) return new Promise<Response>(resolve => { releasePoll = resolve })
      return Response.json(String(input).endsWith('/api/status') ? status() : { tunnels: [] })
    })
    const service = create(request as typeof fetch)
    await service.read(); holdPoll = true
    const poll = service.read(true), save = service.setOwners('compute:0', ['同事'])
    expect(request.mock.calls.filter(([input]) => String(input).endsWith('/api/usage'))).toHaveLength(0)
    holdPoll = false
    releasePoll(Response.json(status())); await poll; await vi.waitFor(() => expect(releaseSave).toBeTypeOf('function'))
    const duringSave = service.read(true)
    const current = status(); current.servers[0]!.gpus[0]!.user_names = ['同事']
    request.mockImplementation(async (input) => Response.json(String(input).endsWith('/api/status') ? current : { tunnels: [] }))
    releaseSave(Response.json({ user_names: ['同事'] }))
    await Promise.all([save, duringSave])
    expect(service.snapshot().servers[0]?.devices[0]?.owners).toEqual(['同事'])
    expect(request.mock.calls.filter(([input]) => String(input).endsWith('/api/status'))).toHaveLength(3)
  })
})
