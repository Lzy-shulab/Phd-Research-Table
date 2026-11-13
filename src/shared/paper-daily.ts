export const PAPER_DAILY_FOLDER = 'paper-daily'

export interface DailyPaper {
  id: string
  title: string
  authors: string
  abstract: string
  journal: string
  publishedDate: string
  doi: string
  source: 'Hugging Face' | 'Crossref'
  url: string
  arxivId?: string
  pdfUrl?: string
  matchReason: string
  favorite: boolean
  paperId?: string
}

export interface PaperDailySnapshot {
  entries: DailyPaper[]
  running: boolean
  downloading: string[]
  message: string
  lastRun: string
}

export const emptyPaperDaily: PaperDailySnapshot = { entries: [], running: false, downloading: [], message: '', lastRun: '' }
