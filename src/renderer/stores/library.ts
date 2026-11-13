import { create } from 'zustand'
import type { LibrarySnapshot, PaperVariant, Result, TranslationProgress } from '../../shared/types'
import { useWorkbench } from './workbench'
import { ARXIV_LIBRARY_FOLDER, defaultArxivSettings } from '../../shared/arxiv'
import { emptyPaperDaily, PAPER_DAILY_FOLDER } from '../../shared/paper-daily'

interface LibraryState extends LibrarySnapshot {
  loaded: boolean
  loadError: string
  folderId: string
  outputYear: string
  outputJournal: string
  filterOutputs: (year: string, journal: string) => void
  reader: { id: string; variant: PaperVariant; page?: number; highlightId?: string; fromDesktop?: boolean } | null
  returningToDesktop: boolean
  load: () => Promise<void>
  selectFolder: (id: string) => void
  openPaper: (id: string, variant?: PaperVariant, page?: number, highlightId?: string, fromDesktop?: boolean) => void
  closeReader: () => void
  setTranslationProgress: (progress: TranslationProgress | null, active: TranslationProgress[]) => void
}
let revision = 0
let progressRevision = 0
export const useLibrary = create<LibraryState>((set, get) => ({
  folders: [], papers: [], autoTranslate: true, metadataOnline: true, metadataAutomatic: true, serverDirectory: '', translationPaused: false, loaded: false, loadError: '',
  translationProgress: null,
  activeTranslationProgress: [],
  paperDaily: emptyPaperDaily,
  journalFolderLabels: {},
  setTranslationProgress: (translationProgress, activeTranslationProgress) => { progressRevision++; set({ translationProgress, activeTranslationProgress }) },
  arxiv: { settings: defaultArxivSettings, running: false, progress: '', runs: [], directory: '', candidates: [], downloads: [], preparation: { pending: 0, failed: 0, ready: 0, error: '' } },
  outputYear: 'all', outputJournal: 'all', filterOutputs: (outputYear, outputJournal) => set({ outputYear, outputJournal }),
  folderId: 'all', reader: null, returningToDesktop: false,
  load: async () => {
    const request = ++revision
    const progressRequest = progressRevision
    try {
      const result = await window.workbench.librarySnapshot()
      if (request !== revision) return
      if (!result.ok) { set({ loadError: result.error.message }); return }
      set((state) => ({ ...result.data, loaded: true, loadError: '',
        ...(progressRequest === progressRevision ? {} : { translationProgress: state.translationProgress, activeTranslationProgress: state.activeTranslationProgress }),
        folderId: ['all', 'unfiled', 'arxiv', ARXIV_LIBRARY_FOLDER, PAPER_DAILY_FOLDER].includes(state.folderId) || result.data.folders.some((f) => f.id === state.folderId) ? state.folderId : 'all' }))
    } catch { set({ loadError: '文献库暂时无法读取，请重试。' }) }
  },
  selectFolder: (folderId) => set({ folderId }),
  openPaper: (id, variant = 'source', page, highlightId, fromDesktop = false) => set(state => ({ returningToDesktop: false, reader: { id, variant, page, highlightId, fromDesktop: fromDesktop || (state.reader?.id === id && state.reader.fromDesktop) } })),
  closeReader: () => {
    if (get().returningToDesktop) return
    if (!get().reader?.fromDesktop) { set({ reader: null }); return }
    // Finish the click and reader exit before hiding its native window.
    set({ returningToDesktop: true })
    setTimeout(() => {
      set({ reader: null })
      requestAnimationFrame(() => { void window.workbench.returnToDesktop() })
    }, 140)
  }
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
