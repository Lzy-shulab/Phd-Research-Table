import { create } from 'zustand'
import { codexReasoningEfforts, type CodexReasoningEffort } from '../../shared/translation'
import { defaultWorkbenchEffort, defaultWorkbenchModel, type WorkbenchCodexEvent } from '../../shared/workbench-codex'

export type AssistantActivity = Extract<WorkbenchCodexEvent, { kind: 'action' }>
export interface AssistantReply { itemId: string; text: string; complete: boolean }
export interface AssistantTurn {
  id: string
  prompt: string
  startedAt: number
  replies: AssistantReply[]
  activity: AssistantActivity[]
  state: 'running' | 'complete' | 'stopped' | 'failed'
  error?: string
}
const preferenceKey = 'workbench.codex.preferences'
function preferences() {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}')
    return { model: typeof value.model === 'string' ? value.model : defaultWorkbenchModel,
      effort: codexReasoningEfforts.includes(value.effort) ? value.effort as CodexReasoningEffort : defaultWorkbenchEffort }
  } catch { return { model: defaultWorkbenchModel, effort: defaultWorkbenchEffort } }
}
interface ChatState {
  model: string
  effort: CodexReasoningEffort
  draft: string
  turns: AssistantTurn[]
  running: string | null
  update: (model: string, effort: CodexReasoningEffort) => void
  receive: (event: WorkbenchCodexEvent) => void
  send: () => Promise<void>
  reset: () => Promise<void>
}
export const useWorkbenchCodex = create<ChatState>((set, get) => ({
  ...preferences(), draft: '', turns: [], running: null,
  update: (model, effort) => { localStorage.setItem(preferenceKey, JSON.stringify({ model, effort })); set({ model, effort }) },
  receive: event => {
    if (get().running !== event.id) return
    set(({ turns }) => ({ turns: turns.map(turn => {
      if (turn.id !== event.id) return turn
      if (event.kind === 'action') {
        return { ...turn, activity: turn.activity.some(item => item.itemId === event.itemId)
          ? turn.activity.map(item => item.itemId === event.itemId ? event : item) : [...turn.activity, event] }
      }
      const existing = turn.replies.find(item => item.itemId === event.itemId)
      const reply = { itemId: event.itemId, text: event.kind === 'message' ? event.text : (existing?.text ?? '') + event.text, complete: event.kind === 'message' }
      return { ...turn, replies: existing ? turn.replies.map(item => item === existing ? reply : item) : [...turn.replies, reply] }
    }) }))
  },
  send: async () => {
    const { draft, model, effort, turns, running } = get()
    const text = draft.trim()
    if (!text || running || !model.trim()) return
    const id = crypto.randomUUID()
    set({ draft: '', running: id, turns: [...turns, { id, prompt: text, startedAt: Date.now(), replies: [], activity: [], state: 'running' }] })
    const finish = (state: AssistantTurn['state'], error?: string) => set(current => ({
      running: null,
      turns: current.turns.map(turn => turn.id === id ? { ...turn, state, error } : turn)
    }))
    try {
      const result = await window.workbench.sendWorkbenchCodex({ id, text, model: model.trim(), effort })
      if (!result.ok) finish('failed', result.error.message)
      else finish(result.data.interrupted ? 'stopped' : 'complete')
    } catch { finish('failed', '无法连接本地 Codex CLI。') }
  },
  reset: async () => {
    if (get().running) return
    const result = await window.workbench.resetWorkbenchCodex()
    if (result.ok) set({ turns: [], draft: '' })
  }
}))
