export const gpuMonitorOrigin = 'https://shulab-gpu-monitor.netlify.app'
export type GpuAvailability = 'idle' | 'busy' | 'unknown'
export interface GpuDevice {
  id: string; key: string; index: number; name: string; state: GpuAvailability
  utilization: number | null; memoryUsedMb: number | null; memoryTotalMb: number | null
  owners: string[]; workloads: number
}
export interface GpuServer {
  id: string; name: string; collectedAt: string; fresh: boolean; warning: string
  devices: GpuDevice[]
}
export interface CpolarTunnel {
  id: string; name: string; url: string; protocol: string
  status: 'online' | 'offline' | 'unknown'; lastSeenAt: string | null
}
export interface GpuMonitorSnapshot {
  auth: 'unknown' | 'required' | 'ready'; error: string | null; updatedAt: string | null
  servers: GpuServer[]; teamMembers: string[]; total: number; idle: number; busy: number; unknown: number
  cpolar: { tunnels: CpolarTunnel[]; checkedAt: string | null; updatedAt: string | null; error: string | null }
  alerts?: { enabled: boolean; available: boolean; error: string | null }
  sshSync?: CpolarSshSyncSnapshot
  rememberedLogin?: boolean
}
export interface CpolarSshSyncSnapshot {
  host: string; configPath: string; syncing: boolean; checkedAt: string | null; syncedAt: string | null
  nextCheckAt: string | null; address: string | null; result: 'updated' | 'unchanged' | null; error: string | null
}
export const emptyGpuSnapshot: GpuMonitorSnapshot = {
  auth: 'unknown', error: null, updatedAt: null, servers: [], teamMembers: [], total: 0, idle: 0, busy: 0, unknown: 0,
  cpolar: { tunnels: [], checkedAt: null, updatedAt: null, error: null }
}
