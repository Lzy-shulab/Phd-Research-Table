import { create } from 'zustand'
import type { Paper } from '../../shared/types'
import { inferLocalMetadata } from '../../domain/metadata'
import { openPdf } from './pdf'
import { useLibrary } from '../stores/library'
import type { PDFDocumentProxy } from 'pdfjs-dist'

export const useMetadataJobs = create<{ ids: Record<string, boolean> }>(() => ({ ids: {} }))
const jobs = new Map<string, Promise<void>>()
let queue: Promise<void> = Promise.resolve()
const stringValue = (value: unknown) => typeof value === 'string' ? value : Array.isArray(value) ? value.filter((item) => typeof item === 'string').join(', ') : ''
export async function readPdfMetadata(pdf: PDFDocumentProxy, originalName: string) {
  try {
    const metadata = await pdf.getMetadata().catch(() => null)
    const info = (metadata?.info ?? {}) as Record<string, unknown>
    const xmp = (name: string) => stringValue(metadata?.metadata?.get(name.toLowerCase()))
    const page = await pdf.getPage(1)
    const text = await page.getTextContent()
    return inferLocalMetadata({
      title: xmp('dc:title') || stringValue(info.Title), authors: xmp('dc:creator') || stringValue(info.Author),
      journal: xmp('prism:publicationName'), publishedDate: xmp('prism:publicationDate'), doi: xmp('prism:doi') || xmp('dc:identifier'),
      pageCount: pdf.numPages, pageHeight: page.getViewport({ scale: 1 }).height, originalName,
      spans: text.items.filter((item) => 'str' in item).map((item) => ({ text: item.str, x: Number(item.transform[4]), y: Number(item.transform[5]), height: Number(item.height) || Math.abs(Number(item.transform[3])) }))
    })
  } finally { await pdf.loadingTask.destroy() }
}
async function identify(paper: Paper) {
  const input = await readPdfMetadata(await openPdf(paper.id, 'source'), paper.originalName)
  const result = await window.workbench.enrichPaperMetadata(paper.id, input)
  if (!result.ok) throw new Error(result.error.message)
}
export function requestMetadata(paper: Paper) {
  const existing = jobs.get(paper.id)
  if (existing) return existing
  useMetadataJobs.setState((state) => ({ ids: { ...state.ids, [paper.id]: true } }))
  const job = queue.then(async () => {
    try { await identify(paper) }
    catch (error) {
      await window.workbench.failPaperMetadata(paper.id, (error instanceof Error ? error.message : '无法读取 PDF 文献信息。').slice(0, 700)).catch(() => undefined)
    }
    await useLibrary.getState().load()
  }).finally(() => {
    jobs.delete(paper.id)
    useMetadataJobs.setState((state) => { const ids = { ...state.ids }; delete ids[paper.id]; return { ids } })
  })
  jobs.set(paper.id, job)
  queue = job.catch(() => undefined)
  return job
}
