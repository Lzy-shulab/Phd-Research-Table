export type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'

export interface UpdateSnapshot {
  state: UpdateState
  currentVersion: string
  latestVersion: string | null
  releaseName: string
  publishedAt: string | null
  progress: number | null
  installable: boolean
  message: string
}
