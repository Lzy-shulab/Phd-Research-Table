import { create } from 'zustand'
import type { SubmissionSnapshot } from '../../shared/types'

interface SubmissionState extends SubmissionSnapshot {
  loaded: boolean
  error: string
  scope: string | null
  setScope: (scope: string | null) => void
  load: () => Promise<void>
}
let revision = 0
export const useSubmissions = create<SubmissionState>((set) => ({
  submissions: [], notificationsSupported: false, notificationError: '', loaded: false, error: '', scope: null,
  setScope: (scope) => set({ scope }),
  load: async () => {
    const request = ++revision
    try {
      const result = await window.workbench.submissionsSnapshot()
      if (request !== revision) return
      if (!result.ok) { set({ error: result.error.message }); return }
      set({ ...result.data, loaded: true, error: '' })
    } catch { set({ error: '投稿记录暂时无法读取，请重试。' }) }
  }
}))
