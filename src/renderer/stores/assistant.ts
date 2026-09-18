import { create } from 'zustand'
import { assistantProfileRequiresKey, type AssistantResult, type AssistantSettings } from '../../shared/assistant'
import { useWorkbench } from './workbench'

interface AssistantState {
  settings: AssistantSettings | null
  open: boolean
  busy: boolean
  recognitionSaving: boolean
  draft: string
  context: string
  projectId: string | null
  result: AssistantResult | null
  error: string
  load: () => Promise<void>
  show: (text?: string, projectId?: string | null) => void
  send: (text: string, projectId: string | null) => Promise<boolean>
  setQuickRecognition: (enabled: boolean) => Promise<boolean>
}
let lastRequest: { signature: string; id: string } | null = null
export const useAssistant = create<AssistantState>((set, get) => ({
  settings: null, open: false, busy: false, recognitionSaving: false, draft: '', context: '', projectId: null, result: null, error: '',
  load: async () => {
    const result = await window.workbench.assistantSettings()
    if (result.ok) set({ settings: result.data })
    else set({ error: result.error.message })
  },
  show: (text, projectId) => {
    set({ open: true, ...(text ? { draft: text, context: '', result: null, error: '' } : {}), ...(projectId !== undefined ? { projectId } : {}) })
    void get().load()
  },
  setQuickRecognition: async (enabled) => {
    if (get().recognitionSaving) return false
    const previous = get().settings
    set({
      recognitionSaving: true,
      error: '',
      ...(previous ? { settings: { ...previous, quickRecognitionEnabled: enabled } } : {})
    })
    try {
      const response = await window.workbench.setAssistantRecognitionEnabled(enabled)
      if (!response.ok) throw new Error(response.error.message)
      set({ settings: response.data })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 识别开关未能保存，请重试。'
      set({ settings: previous, error: message })
      useWorkbench.getState().notify(message)
      return false
    } finally {
      set({ recognitionSaving: false })
    }
  },
  send: async (text, projectId) => {
    if (get().busy || !text.trim()) return false
    const combined = get().context ? `${get().context}\n补充：${text.trim()}` : text.trim()
    const signature = JSON.stringify([combined, projectId])
    if (lastRequest?.signature !== signature) lastRequest = { signature, id: crypto.randomUUID() }
    set({ busy: true, open: true, draft: text, projectId, error: '', result: null })
    try {
      const response = await window.workbench.planWithAssistant({ requestId: lastRequest.id, text: combined, projectId })
      if (!response.ok) throw new Error(response.error.message)
      const result = response.data
      if (result.kind === 'created') {
        useWorkbench.setState((state) => ({ tasks: [...state.tasks.filter((task) => !result.tasks.some((added) => added.id === task.id)), ...result.tasks] }))
        set({ result, draft: '', context: '' })
        lastRequest = null
      } else if (result.kind === 'clarify') {
        set({ result, draft: '', context: combined })
        lastRequest = null
      } else { set({ result, context: '' }); lastRequest = null }
      return true
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'AI 请求未完成，请重试。' })
      return false
    } finally { set({ busy: false }) }
  }
}))
export function assistantConfigured(settings: AssistantSettings | null): boolean {
  const profile = settings?.profiles.find((item) => item.provider === settings.activeProvider)
  return !!profile?.model && !!profile.baseUrl && (!assistantProfileRequiresKey(profile.provider) || profile.hasApiKey)
}
