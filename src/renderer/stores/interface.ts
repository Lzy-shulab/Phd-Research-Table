import { create } from 'zustand'
import { defaultInterfacePreferences, type InterfaceSnapshot, type InterfacePatch } from '../../shared/interface'
import { useWorkbench } from './workbench'

interface InterfaceState extends InterfaceSnapshot {
  loaded: boolean
  saving: boolean
  error: string
  uploading: boolean
  load: () => Promise<void>
  update: (patch: InterfacePatch) => Promise<boolean>
  upload: () => Promise<boolean>
  flush: () => Promise<boolean>
}
let queue: Promise<unknown> = Promise.resolve()
export const useInterface = create<InterfaceState>((set, get) => ({
  preferences: defaultInterfacePreferences, backgroundDataUrl: null, loaded: false, saving: false, uploading: false, error: '',
  flush: async () => { await queue; return !get().uploading },
  load: async () => {
    try {
      const result = await window.workbench.interfacePreferences()
      if (!result.ok) throw new Error(result.error.message)
      set({ ...result.data, loaded: true, error: '' })
    } catch { set({ loaded: true, error: '外观设置暂时无法读取，已使用默认外观。' }) }
  },
  update: (patch) => {
    // Preview on the input event; serialize persistence so rapid changes keep their order.
    const previous = get().preferences
    set({ preferences: { ...previous, ...patch }, saving: true, error: '' })
    const request = queue.then(async () => {
      try {
        const result = await window.workbench.updateInterfacePreferences(patch)
        if (!result.ok) throw new Error(result.error.message)
        if (queue === request) set({ preferences: result.data })
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : '外观设置未能保存。'
        set({ error: message }); useWorkbench.getState().notify(message)
        return false
      }
    })
    queue = request
    void request.then(async (success) => {
      if (queue !== request) return
      if (!success) await get().load()
      set({ saving: false })
    })
    return request
  },
  upload: async () => {
    set({ saving: true, uploading: true, error: '' })
    await queue
    try {
      const result = await window.workbench.uploadBackground()
      if (!result.ok) throw new Error(result.error.message)
      if (!result.data) return false
      set(result.data)
      return true
    } catch (error) { set({ error: error instanceof Error ? error.message : '图片上传未完成。' }); return false }
    finally { set({ saving: false, uploading: false }) }
  }
}))
