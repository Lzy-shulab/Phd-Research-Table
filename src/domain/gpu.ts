import { z } from 'zod'
import type { CpolarTunnel, GpuDevice, GpuServer } from '../shared/gpu'

const metric = z.number().finite().nullable().optional().transform(value => value ?? null)
const processSchema = z.object({ command: z.string().optional(), process_type: z.string().optional(), command_status: z.string().optional() })
const deviceSchema = z.object({ index: z.number(), uuid: z.string().optional(), name: z.string(), utilization: metric,
  memory_used_mb: metric, memory_total_mb: metric, processes: z.array(processSchema).default([]),
  user_names: z.array(z.string()).optional(), user_name: z.string().optional() })
export const gpuOwnersInputSchema = z.object({ deviceId: z.string().min(1), names: z.array(z.string().trim().min(1, '请选择有效的团队成员。')).transform(names => [...new Set(names)]) })
const serverSchema = z.object({
  server_id: z.string(), name: z.string(), collected_at: z.string(), received_at: z.string(),
  collector_error: z.string().nullable().optional(), warnings: z.array(z.string()).default([]), gpus: z.array(deviceSchema)
})
const sourceSchema = z.object({ server_now: z.string(), stale_after_seconds: z.number().optional(), team_members: z.array(z.string()).default([]), servers: z.array(serverSchema) })
const desktopProcess = /^(?:nautilus|Xorg|Xwayland|gnome-shell|gnome-remote-desktop(?:-daemon)?|kwin_wayland|kwin_x11|plasmashell|nvidia-settings|nvidia-persistenced|gdm|cinnamon|xdg-desktop-portal(?:-.*)?)$/i
const computeProcess = /^(?:python(?:\d+(?:\.\d+)*)?|torchrun|accelerate|deepspeed|vllm|ollama|llama(?:-server|-cli|\.cpp)?|tritonserver|text-generation-launcher|jupyter(?:-lab|-notebook)?)$/i
export function isGpuWorkload(process: z.infer<typeof processSchema>) {
  if (process.command_status === 'exited') return false
  const tokens = (process.command ?? '').match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  while (tokens.length && (/^\w+=/.test(tokens[0]!) || /(?:^|\/)env$/.test(tokens[0]!))) tokens.shift()
  const command = (tokens[0] ?? '').replace(/^["']|["']$/g, '').split(/[\\/]/).at(-1) ?? ''
  return !desktopProcess.test(command) && (computeProcess.test(command) || ['C', 'C+G'].includes(process.process_type ?? ''))
}
export function parseGpuStatus(input: unknown) {
  const data = sourceSchema.parse(input)
  const servers: GpuServer[] = data.servers.map(server => {
    const stamp = Math.min(Date.parse(server.collected_at), Date.parse(server.received_at))
    const age = Date.parse(data.server_now) - stamp
    const fresh = Number.isFinite(age) && Math.max(0, age) <= (data.stale_after_seconds ?? 90) * 1000
    const reliable = fresh && !server.collector_error && !server.warnings.some(warning => warning.includes('进程列表'))
    const devices: GpuDevice[] = server.gpus.map(gpu => {
      const workloads = gpu.processes.filter(isGpuWorkload).length
      return { id: `${server.server_id}:${gpu.uuid ?? gpu.index}`, key: gpu.uuid || `index:${gpu.index}`, index: gpu.index, name: gpu.name,
        state: !reliable ? 'unknown' : workloads ? 'busy' : gpu.utilization === null ? 'unknown' : 'idle',
        utilization: gpu.utilization, memoryUsedMb: gpu.memory_used_mb, memoryTotalMb: gpu.memory_total_mb,
        owners: gpu.user_names ?? (gpu.user_name ? [gpu.user_name] : []), workloads }
    })
    return { id: server.server_id, name: server.name, collectedAt: server.collected_at, fresh,
      warning: server.collector_error || server.warnings.join('；') || (!fresh ? '采集数据已过期' : ''), devices }
  })
  const devices = servers.flatMap(server => server.devices)
  return { servers, teamMembers: data.team_members, total: devices.length, idle: devices.filter(gpu => gpu.state === 'idle').length,
    busy: devices.filter(gpu => gpu.state === 'busy').length, unknown: devices.filter(gpu => gpu.state === 'unknown').length }
}
export function parseLiveGpuStatus(input: unknown, collection: unknown) {
  const source = sourceSchema.parse(input)
  const live = serverSchema.omit({ received_at: true }).parse(collection)
  if (live.collector_error) throw new Error(live.collector_error)
  const previous = source.servers.find(server => server.server_id === live.server_id)
  if (!previous) throw new Error('实时采集的服务器与 GPU 看板不一致，请检查连接配置。')
  const server = { ...live, received_at: live.collected_at, gpus: live.gpus.map(gpu => {
    const saved = previous.gpus.find(item => gpu.uuid ? item.uuid === gpu.uuid : item.index === gpu.index)
    return { ...gpu, user_names: saved?.user_names, user_name: saved?.user_name }
  }) }
  return parseGpuStatus({ ...source, server_now: live.collected_at,
    servers: source.servers.map(item => item.server_id === live.server_id ? server : item) })
}
export function parseCpolar(input: unknown) {
  const data = z.object({ checked_at: z.string().nullable().optional(), error: z.string().nullable().optional(), message: z.string().optional(),
    tunnels: z.array(z.object({ id: z.string(), name: z.string(), url: z.string(), protocol: z.string(),
      status: z.enum(['online', 'offline', 'unknown']), last_seen_at: z.string().nullable().optional() })) }).parse(input)
  const tunnels: CpolarTunnel[] = data.tunnels.map(tunnel => ({ id: tunnel.id, name: tunnel.name, url: tunnel.url,
    protocol: tunnel.protocol, status: data.error ? 'unknown' : tunnel.status, lastSeenAt: tunnel.last_seen_at ?? null }))
  return { tunnels, checkedAt: data.checked_at ?? null, error: data.error || data.message || null }
}
