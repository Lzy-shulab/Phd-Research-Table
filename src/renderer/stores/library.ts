import { create } from 'zustand'
import type { LibrarySnapshot, PaperVariant, Result, TranslationProgress } from '../../shared/types'
import { useWorkbench } from './workbench'
import { ARXIV_LIBRARY_FOLDER, defaultArxivSettings } from '../../shared/arxiv'

interface LibraryState extends LibrarySnapshot {
  loaded: boolean
  loadError: string
  folderId: string
  outputYear: string
  outputJournal: string
  filterOutputs: (year: string, journal: string) => void
  reader: { id: string; variant: PaperVariant; page?: number; highlightId?: string } | null
  load: () => Promise<void>
  selectFolder: (id: string) => void
  openPaper: (id: string, variant?: PaperVariant, page?: number, highlightId?: string) => void
  closeReader: () => void
  setTranslationProgress: (progress: TranslationProgress | null) => void
}
let revision = 0
let progressRevision = 0
export const useLibrary = create<LibraryState>((set) => ({
  folders: [], papers: [], autoTranslate: true, metadataOnline: true, metadataAutomatic: true, serverDirectory: '', translationPaused: false, loaded: false, loadError: '',
  translationProgress: null,
  setTranslationProgress: (translationProgress) => { progressRevision++; set({ translationProgress }) },
  arxiv: { settings: defaultArxivSettings, running: false, progress: '', runs: [], directory: '', candidates: [], downloads: [], preparation: { pending: 0, failed: 0, ready: 0, error: '' } },
  outputYear: 'all', outputJournal: 'all', filterOutputs: (outputYear, outputJournal) => set({ outputYear, outputJournal }),
  folderId: 'all', reader: null,
  load: async () => {
    const request = ++revision
    const progressRequest = progressRevision
    try {
      const result = await window.workbench.librarySnapshot()
      if (request !== revision) return
      if (!result.ok) { set({ loadError: result.error.message }); return }
      set((state) => ({ ...result.data, loaded: true, loadError: '',
        translationProgress: progressRequest === progressRevision ? result.data.translationProgress : state.translationProgress,
        folderId: ['all', 'unfiled', 'arxiv', ARXIV_LIBRARY_FOLDER].includes(state.folderId) || result.data.folders.some((f) => f.id === state.folderId) ? state.folderId : 'all' }))
    } catch { set({ loadError: '文献库暂时无法读取，请重试。' }) }
  },
  selectFolder: (folderId) => set({ folderId }),
  openPaper: (id, variant = 'source', page, highlightId) => set({ reader: { id, variant, page, highlightId } }),
  closeReader: () => set({ reader: null })
}))

export async function libraryAction<T>(promise: Promise<Result<T>>, success?: string): Promise<T | undefined> {
  try {
    const result = await promise
    if (!result.ok) { useWorkbench.getState().notify(result.error.message); return undefined }
    await useLibrary.getState().load()
    if (success) useWorkbench.getState().notify(success, 'info')
    return result.data
  } catch { useWorkbench.getState().notify('操作未完成，请检查文件后重试。'); return undefined }
}
