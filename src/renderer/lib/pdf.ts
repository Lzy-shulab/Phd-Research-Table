import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker'
import type { PaperVariant } from '../../shared/types'

GlobalWorkerOptions.workerPort = new PdfWorker()

export async function openPdf(id: string, variant: PaperVariant): Promise<PDFDocumentProxy> {
  const result = await window.workbench.readPaper(id, variant)
  if (!result.ok) throw new Error(result.error.message)
  return openPdfBytes(result.data)
}
export function openPdfBytes(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({
    data: new Uint8Array(bytes), useWorkerFetch: false,
    cMapPacked: true,
    cMapUrl: new URL('./pdfjs/cmaps/', window.location.href).href,
    standardFontDataUrl: new URL('./pdfjs/standard_fonts/', window.location.href).href,
    wasmUrl: new URL('./pdfjs/wasm/', window.location.href).href
  }).promise
}
