import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Minus, Plus } from 'lucide-react'
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import type { Paper, PaperVariant } from '../../../shared/types'
import { openPdf } from '../../lib/pdf'
import { libraryAction, useLibrary } from '../../stores/library'
import { Dialog } from '../ui/dialog'
import { Button } from '../ui/button'

function PageCanvas({ pdf, number, zoom, onRendered }: { pdf: PDFDocumentProxy; number: number; zoom: number; onRendered: (page: number) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const callback = useRef(onRendered)
  callback.current = onRendered
  const [width, setWidth] = useState(800)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = host.current?.parentElement
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(Math.max(320, element.clientWidth - 80)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let active = true, rendering: RenderTask | undefined, layer: TextLayer | undefined
    const canvasElement = canvas.current!, textElement = text.current!, hostElement = host.current!
    setError('')
    void (async () => {
      const page = await pdf.getPage(number)
      if (!active) return
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(width / base.width, 1.65) * zoom })
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvasElement.width = Math.ceil(viewport.width * ratio); canvasElement.height = Math.ceil(viewport.height * ratio)
      canvasElement.style.width = `${viewport.width}px`; canvasElement.style.height = `${viewport.height}px`
      hostElement.style.width = `${viewport.width}px`; hostElement.style.height = `${viewport.height}px`
      hostElement.style.setProperty('--scale-factor', String(viewport.scale))
      hostElement.style.setProperty('--total-scale-factor', String(viewport.scale))
      textElement.replaceChildren()
      rendering = page.render({ canvas: canvasElement, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
      await rendering.promise
      if (!active) return
      layer = new TextLayer({ textContentSource: page.streamTextContent(), container: textElement, viewport })
      await layer.render()
      if (active) callback.current(number)
    })().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '本页暂时无法显示。')
    })
    return () => { active = false; rendering?.cancel(); layer?.cancel() }
  }, [pdf, number, zoom, width])
  return <div ref={host} className="pdf-page" data-testid="pdf-page" aria-label={`第 ${number} 页`}>
    <canvas ref={canvas} aria-label={`PDF 第 ${number} 页`} /><div ref={text} className="textLayer" />
    {error && <p className="pdf-page-error" role="alert">{error}</p>}
  </div>
}

function ReaderContent({ paper, variant, setVariant }: { paper: Paper; variant: PaperVariant; setVariant: (variant: PaperVariant) => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [page, setPage] = useState(() => Math.max(1, variant === 'source' ? paper.readPage : paper.translatedReadPage))
  const [zoom, setZoom] = useState(1)
  const [draftPage, setDraftPage] = useState('')
  const lastSaved = useRef(0)
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let active = true, document: PDFDocumentProxy | undefined
    void openPdf(paper.id, variant).then((value) => {
      document = value
      if (active) { setPdf(value); setPage((current) => Math.min(current, value.numPages)) }
      else void value.loadingTask.destroy()
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '无法打开文献。') })
    return () => { active = false; void document?.loadingTask.destroy() }
  }, [paper.id, variant])
  const go = (next: number) => { if (pdf) { setPage(Math.max(1, Math.min(pdf.numPages, next))); setDraftPage(''); scroll.current?.scrollTo(0, 0) } }
  return <>
    <div className="reader-toolbar">
      <Button variant="ghost" onClick={() => useLibrary.getState().closeReader()}><ArrowLeft size={16} />{paper.collection === 'publication' ? '返回科研成果' : paper.collection === 'arxiv' ? '返回 Arxiv Daily' : '返回文献库'}</Button>
      <div className="segmented-control" aria-label="文献版本">
        <button aria-pressed={variant === 'source'} onClick={() => setVariant('source')}>原文</button>
        <button aria-pressed={variant === 'translated'} disabled={!paper.translatedPath} onClick={() => setVariant('translated')}>中英对照</button>
      </div>
      <div className="reader-tools">
        <Button variant="ghost" className="icon-button" aria-label="缩小文献" disabled={zoom <= 0.6} onClick={() => setZoom((v) => Math.max(0.6, v - 0.2))}><Minus size={16} /></Button>
        <button className="reader-fit" onClick={() => setZoom(1)} title="恢复适合宽度">{Math.round(zoom * 100)}%</button>
        <Button variant="ghost" className="icon-button" aria-label="放大文献" disabled={zoom >= 2.2} onClick={() => setZoom((v) => Math.min(2.2, v + 0.2))}><Plus size={16} /></Button>
        <Button variant="ghost" aria-label="导出当前 PDF" onClick={() => void libraryAction(window.workbench.exportPaper(paper.id, variant))}><Download size={16} /></Button>
      </div>
    </div>
    <div className="reader-scroll" ref={scroll} tabIndex={0} aria-label="文献阅读区域" onKeyDown={(event) => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); go(page + 1) }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); go(page - 1) }
    }}>
      {error ? <div className="reader-message" role="alert">{error}</div> : pdf ? <PageCanvas pdf={pdf} number={page} zoom={zoom} onRendered={(number) => {
        if (lastSaved.current === number) return
        lastSaved.current = number
        void libraryAction(window.workbench.updatePaper(paper.id, {
          ...(variant === 'source' ? { readPage: number, pageCount: pdf.numPages } : { translatedReadPage: number }), readProgress: Math.round(number / pdf.numPages * 100), lastReadAt: new Date().toISOString()
        }))
      }} /> : <div className="reader-message"><span className="tiny-spinner" />正在打开 PDF…</div>}
    </div>
    <footer className="reader-footer"><span>{variant === 'translated' ? '左侧英文 · 右侧中文' : '原始 PDF · 可选择文字'}</span>
      <div><Button variant="ghost" className="icon-button" aria-label="上一页文献" disabled={!pdf || page <= 1} onClick={() => go(page - 1)}><ChevronLeft size={17} /></Button>
        <form onSubmit={(event) => { event.preventDefault(); const number = Number(draftPage); if (Number.isInteger(number)) go(number) }}>
          <input aria-label="文献页码" inputMode="numeric" value={draftPage || String(page)} onChange={(event) => setDraftPage(event.target.value)} onBlur={() => { if (draftPage) { const number = Number(draftPage); if (Number.isInteger(number)) go(number); else setDraftPage('') } }} />
          <span>/ {pdf?.numPages ?? '…'}</span>
        </form>
        <Button variant="ghost" className="icon-button" aria-label="下一页文献" disabled={!pdf || page >= pdf.numPages} onClick={() => go(page + 1)}><ChevronRight size={17} /></Button>
      </div><span>阅读位置自动保存</span>
    </footer>
  </>
}

export function PdfReader() {
  const reader = useLibrary((s) => s.reader)
  const paper = useLibrary((s) => s.papers.find((p) => p.id === reader?.id))
  if (!reader || !paper) return null
  return <Dialog open className="reader-dialog" title={paper.title} description="文献阅读器" onOpenChange={(open) => { if (!open) useLibrary.getState().closeReader() }}>
    <ReaderContent key={`${paper.id}-${reader.variant}`} paper={paper} variant={reader.variant}
      setVariant={(variant) => useLibrary.getState().openPaper(paper.id, variant)} />
  </Dialog>
}
