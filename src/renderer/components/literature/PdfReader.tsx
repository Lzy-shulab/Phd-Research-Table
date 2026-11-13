import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Download, Hand, Highlighter, Minus, Plus, PanelRightClose, PanelRightOpen, NotebookPen, Trash2 } from 'lucide-react'
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import type { Paper, PaperHighlight, PaperHighlightColor, PaperHighlightRect, PaperVariant } from '../../../shared/types'
import { openPdf } from '../../lib/pdf'
import { libraryAction, useLibrary } from '../../stores/library'
import { Dialog } from '../ui/dialog'
import { Button } from '../ui/button'
import { Disclosure } from '../ui/disclosure'
import { mergeHighlightRects } from '../../lib/highlights'
import './reader-focus.css'

type HighlightDraft = Pick<PaperHighlight, 'page' | 'text' | 'rects'>
type SelectionPalette = HighlightDraft & { left: number; top: number }
type HighlightLocation = { id: string; request: number }

const highlightOptions: { color: PaperHighlightColor; label: string }[] = [
  { color: 'focus', label: '重点' },
  { color: 'method', label: '方法' },
  { color: 'evidence', label: '证据' },
  { color: 'question', label: '疑问' }
]
const minZoom = 0.4
const maxZoom = 4
const limitZoom = (value: number) => Math.max(minZoom, Math.min(maxZoom, value))

function clamp(value: number) { return Math.max(0, Math.min(1, value)) }
function normalizedRect(rect: DOMRect, page: DOMRect): PaperHighlightRect | null {
  const left = Math.max(rect.left, page.left), right = Math.min(rect.right, page.right)
  const top = Math.max(rect.top, page.top), bottom = Math.min(rect.bottom, page.bottom)
  if (right - left < 1 || bottom - top < 1) return null
  return {
    x: clamp((left - page.left) / page.width), y: clamp((top - page.top) / page.height),
    width: clamp((right - left) / page.width), height: clamp((bottom - top) / page.height)
  }
}

function PageCanvas({ pdf, number, zoom, highlights, activeHighlight, onHighlight, onResize, onRendered }: {
  pdf: PDFDocumentProxy
  number: number
  zoom: number
  highlights: PaperHighlight[]
  activeHighlight: HighlightLocation | null
  onHighlight: (draft: HighlightDraft, color: PaperHighlightColor) => Promise<boolean>
  onResize: (page: HTMLDivElement) => void
  onRendered: (page: number) => void
}) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), text = useRef<HTMLDivElement>(null), callback = useRef(onRendered), resize = useRef(onResize)
  callback.current = onRendered
  resize.current = onResize
  const [width, setWidth] = useState(800), [error, setError] = useState(''), [palette, setPalette] = useState<SelectionPalette | null>(null)
  const [renderedRevision, setRenderedRevision] = useState(0)
  useEffect(() => {
    let anchor: CaretPosition | null = null, focus: CaretPosition | null = null, frame = 0
    let pointer: { x: number; y: number } | null = null
    const apply = () => {
      frame = 0
      const viewport = host.current?.parentElement
      if (anchor && pointer && viewport) {
        const bounds = viewport.getBoundingClientRect()
        const top = bounds.top + viewport.clientTop, bottom = top + viewport.clientHeight
        const step = pointer.y < top + 24 ? -Math.min(18, (top + 24 - pointer.y) / 2)
          : pointer.y > bottom - 24 ? Math.min(18, (pointer.y - bottom + 24) / 2) : 0
        const before = viewport.scrollTop
        viewport.scrollTop += step
        const point = document.caretPositionFromPoint(pointer.x, Math.max(top + 2, Math.min(bottom - 2, pointer.y)))
        if (point && text.current?.contains(point.offsetNode)) focus = point
        if (step && viewport.scrollTop !== before) frame = requestAnimationFrame(apply)
      }
      if (anchor && focus && text.current?.contains(anchor.offsetNode) && text.current.contains(focus.offsetNode)) {
        window.getSelection()?.setBaseAndExtent(anchor.offsetNode, anchor.offset, focus.offsetNode, focus.offset)
      }
    }
    const begin = (event: MouseEvent) => {
      cancelAnimationFrame(frame); frame = 0; anchor = focus = null; pointer = null
      if (!(event.target as Element).closest('.textLayer, .highlight-palette')) setPalette(null)
      if (event.button !== 0 || event.detail !== 1 || event.shiftKey || event.ctrlKey || host.current?.parentElement?.classList.contains('reader-hand') || !text.current?.contains(event.target as Node) || host.current?.dataset.rendered !== 'true') return
      anchor = document.caretPositionFromPoint(event.clientX, event.clientY)
      if (anchor && text.current.contains(anchor.offsetNode)) {
        event.preventDefault()
        host.current.parentElement?.focus({ preventScroll: true })
        window.getSelection()?.collapse(anchor.offsetNode, anchor.offset)
      }
    }
    const move = (event: MouseEvent) => {
      if (!anchor || !(event.buttons & 1)) return
      pointer = { x: event.clientX, y: event.clientY }
      const point = document.caretPositionFromPoint(event.clientX, event.clientY)
      if (point && text.current?.contains(point.offsetNode)) {
        focus = point
      }
      // Keep the starting caret fixed across transformed PDF text spans.
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const end = () => { cancelAnimationFrame(frame); pointer = null; apply(); anchor = focus = null }
    document.addEventListener('mousedown', begin, true)
    document.addEventListener('mousemove', move, true)
    document.addEventListener('mouseup', end, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', begin, true)
      document.removeEventListener('mousemove', move, true)
      document.removeEventListener('mouseup', end, true)
    }
  }, [])
  useEffect(() => {
    const element = host.current?.parentElement
    if (!element) return
    const observer = new ResizeObserver(() => {
      const styles = getComputedStyle(element)
      setWidth(Math.max(240, element.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let active = true, rendering: RenderTask | undefined, layer: TextLayer | undefined
    const canvasElement = canvas.current!, textElement = text.current!, hostElement = host.current!
    hostElement.dataset.rendered = 'false'
    setError(''); setPalette(null)
    void (async () => {
      const page = await pdf.getPage(number)
      if (!active) return
      const base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: Math.min(width / base.width, 1.85) * zoom })
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(24_000_000 / (viewport.width * viewport.height)))
      canvasElement.width = Math.ceil(viewport.width * ratio); canvasElement.height = Math.ceil(viewport.height * ratio)
      canvasElement.style.width = `${viewport.width}px`; canvasElement.style.height = `${viewport.height}px`
      hostElement.style.width = `${viewport.width}px`; hostElement.style.height = `${viewport.height}px`
      resize.current(hostElement)
      hostElement.style.setProperty('--scale-factor', String(viewport.scale)); hostElement.style.setProperty('--total-scale-factor', String(viewport.scale))
      textElement.replaceChildren()
      rendering = page.render({ canvas: canvasElement, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
      await rendering.promise
      if (!active) return
      layer = new TextLayer({ textContentSource: page.streamTextContent(), container: textElement, viewport })
      await layer.render()
      if (active) { hostElement.dataset.rendered = 'true'; setRenderedRevision(revision => revision + 1); callback.current(number) }
    })().catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '本页暂时无法显示。') })
    return () => { active = false; rendering?.cancel(); layer?.cancel() }
  }, [pdf, number, zoom, width])

  const showPalette = () => {
    const selection = window.getSelection(), hostElement = host.current, textElement = text.current
    if (!selection || selection.isCollapsed || !selection.rangeCount || !hostElement || !textElement) { setPalette(null); return }
    const range = selection.getRangeAt(0)
    if (!textElement.contains(range.commonAncestorContainer)) { setPalette(null); return }
    const selected = selection.toString().replace(/\s+/g, ' ').trim().slice(0, 10000)
    const bounds = hostElement.getBoundingClientRect()
    const clientRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    const rects = mergeHighlightRects(clientRects.map((rect) => normalizedRect(rect, bounds)).filter((rect): rect is PaperHighlightRect => !!rect))
    if (!selected || !rects.length) { setPalette(null); return }
    const first = clientRects[0]!
    setPalette({
      page: number, text: selected, rects,
      left: Math.max(112, Math.min(hostElement.clientWidth - 112, first.left - bounds.left + first.width / 2)),
      top: Math.max(58, first.top - bounds.top)
    })
  }

  const commitHighlight = async (color: PaperHighlightColor) => {
    if (!palette) return
    const draft = palette
    window.getSelection()?.removeAllRanges()
    setPalette(null)
    if (!await onHighlight(draft, color)) setPalette(draft)
  }

  useEffect(() => {
    if (!activeHighlight || host.current?.dataset.rendered !== 'true') return
    const marks = Array.from(host.current.querySelectorAll<HTMLElement>('[data-highlight-id]')).filter(element => element.dataset.highlightId === activeHighlight.id)
    marks[0]?.scrollIntoView({ block: 'center', behavior: 'instant' })
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animations = marks.map(element => element.animate(
      reducedMotion ? [{ opacity: 0.58 }, { opacity: 0.32 }] : [{ opacity: 0.32 }, { opacity: 0.78, offset: 0.2 }, { opacity: 0.32 }],
      { duration: reducedMotion ? 500 : 1100, easing: 'ease-out' }
    ))
    return () => animations.forEach(animation => animation.cancel())
  }, [activeHighlight, number, renderedRevision])

  return <div ref={host} className="pdf-page" data-testid="pdf-page" aria-label={`第 ${number} 页`} onPointerDown={(event) => { if ((event.target as Element).closest('.textLayer')) setPalette(null) }} onMouseUp={showPalette} onKeyUp={(event) => { if (event.key === 'Shift') showPalette() }}>
    <canvas ref={canvas} aria-label={`PDF 第 ${number} 页`} />
    <div className="pdf-highlight-layer" aria-label={`第 ${number} 页划线`}>
      {highlights.flatMap((highlight) => mergeHighlightRects(highlight.rects).map((rect, index) => <span key={`${highlight.id}-${index}`} data-highlight-id={highlight.id} className={`pdf-highlight highlight-${highlight.color}${activeHighlight?.id === highlight.id ? ' is-located' : ''}`} title={`${highlightOptions.find((item) => item.color === highlight.color)?.label ?? '划线'}：${highlight.text}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />))}
    </div>
    <div ref={text} className="textLayer" />
    {palette && <div className="highlight-palette" role="toolbar" aria-label="选择划线颜色" style={{ left: palette.left, top: palette.top }}>
      {highlightOptions.map((option) => <button key={option.color} className={`highlight-choice highlight-${option.color}`} aria-label={`${option.label}划线`} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation() }} onMouseUp={(event) => event.stopPropagation()} onClick={() => void commitHighlight(option.color)}><i />{option.label}</button>)}
    </div>}
    {error && <p className="pdf-page-error" role="alert">{error}</p>}
  </div>
}

let readerLifecycle = Promise.resolve()

function ReaderContent({ paper, variant, initialPage, initialHighlight, setVariant, onClose }: {
  paper: Paper; variant: PaperVariant; setVariant: (variant: PaperVariant) => void; onClose: () => void
  initialPage?: number
  initialHighlight?: string
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [error, setError] = useState('')
  const [page, setPage] = useState(() => Math.max(1, initialPage ?? (variant === 'source' ? paper.readPage : paper.translatedReadPage)))
  const [zoom, setZoom] = useState(1), [draftPage, setDraftPage] = useState('')
  const [notesOpen, setNotesOpen] = useState(true)
  const [hand, setHand] = useState(false), [panning, setPanning] = useState(false)
  const [openColor, setOpenColor] = useState<PaperHighlightColor | null>(() => paper.highlights.find(highlight => highlight.id === initialHighlight)?.color ?? null)
  const [activeHighlight, setActiveHighlight] = useState<HighlightLocation | null>(() => initialHighlight ? { id: initialHighlight, request: 0 } : null)
  const locateSequence = useRef(0)
  const lastSaved = useRef(0), scroll = useRef<HTMLDivElement>(null)
  const zoomAnchor = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const pan = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  const highlightQueue = useRef(Promise.resolve(false))
  useEffect(() => {
    let active = true, document: PDFDocumentProxy | undefined
    const opening = readerLifecycle.then(async () => {
      if (!active) return
      document = await openPdf(paper.id, variant)
      if (active) { setPdf(document); setPage(current => Math.min(current, document!.numPages)) }
    })
    readerLifecycle = opening.catch(() => {})
    void opening.catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '无法打开文献。') })
    return () => {
      active = false
      // PDF.js shares its worker; finish disposal before opening the next version.
      readerLifecycle = readerLifecycle.then(async () => { await document?.loadingTask.destroy() }).catch(() => {})
    }
  }, [paper.id, variant])
  useEffect(() => {
    const viewport = scroll.current
    if (!viewport) return
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const bounds = viewport.querySelector('.pdf-page')?.getBoundingClientRect()
      if (!bounds?.width || !bounds.height) return
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1)
      setZoom(current => {
        const next = limitZoom(current * Math.exp(-delta * 0.002))
        if (next !== current) zoomAnchor.current = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height, left: event.clientX, top: event.clientY }
        return next
      })
    }
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel)
  }, [])
  const restoreZoomAnchor = (element: HTMLDivElement) => {
    const anchor = zoomAnchor.current, viewport = scroll.current
    if (!anchor || !viewport) return
    zoomAnchor.current = null
    const bounds = element.getBoundingClientRect()
    viewport.scrollBy(bounds.left + bounds.width * anchor.x - anchor.left, bounds.top + bounds.height * anchor.y - anchor.top)
  }
  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element
    if (event.pointerType !== 'mouse' || target.closest('button, .highlight-palette') ||
      !(event.button === 1 || event.button === 0 && (hand || event.ctrlKey || !target.closest('.textLayer span')))) return
    const viewport = event.currentTarget
    if (event.target === viewport) {
      const bounds = viewport.getBoundingClientRect()
      if (event.clientX >= bounds.left + viewport.clientWidth || event.clientY >= bounds.top + viewport.clientHeight) return
    }
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    viewport.focus({ preventScroll: true })
    viewport.setPointerCapture(event.pointerId)
    pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }
    setPanning(true)
  }
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const start = pan.current
    if (start?.id !== event.pointerId) return
    event.currentTarget.scrollTo(start.left + start.x - event.clientX, start.top + start.y - event.clientY)
  }
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current?.id !== event.pointerId) return
    pan.current = null
    setPanning(false)
  }
  const go = (next: number) => { if (pdf) { zoomAnchor.current = null; setPage(Math.max(1, Math.min(pdf.numPages, next))); setDraftPage(''); setActiveHighlight(null); scroll.current?.scrollTo(0, 0) } }
  const addHighlight = (draft: HighlightDraft, color: PaperHighlightColor) => {
    const request = highlightQueue.current.then(async () => {
      const current = useLibrary.getState().papers.find((item) => item.id === paper.id)
      if (!current) return false
      const highlight: PaperHighlight = { page: draft.page, text: draft.text, rects: draft.rects, id: crypto.randomUUID(), color, variant, createdAt: new Date().toISOString() }
      const saved = await libraryAction(window.workbench.updatePaper(paper.id, { highlights: [...current.highlights, highlight] }))
      if (saved) setOpenColor(color)
      return !!saved
    })
    highlightQueue.current = request.catch(() => false)
    return request
  }
  const pageHighlights = paper.highlights.filter((highlight) => highlight.page === page && (!highlight.variant || highlight.variant === variant))
  const sortedHighlights = [...paper.highlights].sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt))
  const removeHighlight = async (id: string) => {
    const current = useLibrary.getState().papers.find(item => item.id === paper.id)
    if (current) await libraryAction(window.workbench.updatePaper(paper.id, { highlights: current.highlights.filter(highlight => highlight.id !== id) }))
  }
  return <>
    <div className="reader-toolbar">
      <Button variant="ghost" className="reader-back-button" onClick={onClose}><ArrowLeft size={16} />{paper.collection === 'publication' ? '返回科研成果' : '返回文献库'}</Button>
      <div className="reader-center-tools"><div className="segmented-control" aria-label="文献版本"><button aria-pressed={variant === 'source'} onClick={() => setVariant('source')}>原文</button><button aria-pressed={variant === 'translated'} disabled={!paper.translatedPath} onClick={() => setVariant('translated')}>中英对照</button></div><span className="reader-highlight-hint"><Highlighter size={14} />选择正文即可划线</span></div>
      <div className="reader-tools"><Button variant="ghost" className="reader-notes-toggle" aria-label={notesOpen ? '收起批注栏' : '展开批注栏'} aria-pressed={notesOpen} onClick={() => setNotesOpen(value => !value)}>{notesOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}<span>批注</span></Button><Button variant="ghost" className="icon-button" aria-label="拖拽页面" title="抓手工具 · Ctrl + 滚轮缩放" aria-pressed={hand} onClick={() => setHand(value => !value)}><Hand size={16} /></Button><Button variant="ghost" className="icon-button" aria-label="缩小文献" disabled={zoom <= minZoom} onClick={() => setZoom(value => limitZoom(value - 0.2))}><Minus size={16} /></Button><button className="reader-fit" onClick={() => setZoom(1)} title="恢复适合宽度">{Math.round(zoom * 100)}%</button><Button variant="ghost" className="icon-button" aria-label="放大文献" disabled={zoom >= maxZoom} onClick={() => setZoom(value => limitZoom(value + 0.2))}><Plus size={16} /></Button><Button variant="ghost" className="icon-button" aria-label="导出当前 PDF" onClick={() => void libraryAction(window.workbench.exportPaper(paper.id, variant))}><Download size={16} /></Button></div>
    </div>
    <div className={`reader-layout reader-with-notes${notesOpen ? '' : ' notes-collapsed'}`}>
      <div className={`reader-scroll${hand ? ' reader-hand' : ''}${panning ? ' reader-panning' : ''}`} ref={scroll} tabIndex={0} aria-label="文献阅读区域"
        onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}
        onKeyDown={(event) => { if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || (event.target as Element).closest('button, input, textarea')) return; if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); go(page + 1) } if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); go(page - 1) } }}>
        {error ? <div className="reader-message" role="alert">{error}</div> : pdf ? <PageCanvas pdf={pdf} number={page} zoom={zoom} highlights={pageHighlights} activeHighlight={activeHighlight} onHighlight={addHighlight} onResize={restoreZoomAnchor} onRendered={(number) => {
          if (lastSaved.current === number) return
          lastSaved.current = number
          const maxReadPage = Math.max(paper.maxReadPage, number), readingStatus = paper.readingStatus === 'unread' ? 'reading' : paper.readingStatus
          const readProgress = readingStatus === 'done' ? 100 : Math.min(99, Math.round(maxReadPage / pdf.numPages * 100))
          void libraryAction(window.workbench.updatePaper(paper.id, { ...(variant === 'source' ? { readPage: number, pageCount: pdf.numPages } : { translatedReadPage: number }), maxReadPage, readingStatus, readProgress, lastReadAt: new Date().toISOString() }))
        }} /> : <div className="reader-message"><span className="tiny-spinner" />正在打开 PDF…</div>}
      </div>
      {notesOpen && <aside className="reader-notes-panel" aria-label="阅读批注">
        <header><NotebookPen size={18} /><h2>阅读批注</h2><span className="reader-annotation-total">共 {paper.highlights.length} 处</span></header>
        <div className="reader-notes-scroll">
          <section className="reader-annotations reader-annotation-groups" aria-label="批注分类">
            {highlightOptions.map(option => {
              const items = sortedHighlights.filter(highlight => highlight.color === option.color)
              const expanded = openColor === option.color
              return <div key={option.color} className={`reader-annotation-group highlight-${option.color}`}>
                <h3><button id={`annotation-category-${option.color}`} className="reader-category-toggle" aria-expanded={expanded} aria-controls={`annotation-list-${option.color}`} onClick={() => setOpenColor(current => current === option.color ? null : option.color)}><i /><span>{option.label}</span><small>{items.length}</small><ChevronDown size={15} /></button></h3>
                <Disclosure open={expanded} id={`annotation-list-${option.color}`} role="region" aria-labelledby={`annotation-category-${option.color}`}><div className="reader-annotation-list">
                  {items.length ? items.map(highlight => <article key={highlight.id} className={`reader-annotation highlight-${highlight.color}${activeHighlight?.id === highlight.id ? ' is-active' : ''}`}>
                    <button className="reader-annotation-jump" onClick={() => { if (highlight.variant && highlight.variant !== variant) useLibrary.getState().openPaper(paper.id, highlight.variant, highlight.page, highlight.id); else { go(highlight.page); setActiveHighlight({ id: highlight.id, request: ++locateSequence.current }) } }} aria-label={`跳到第 ${highlight.page} 页批注：${highlight.text}`}><span><small>{highlight.variant === 'translated' ? '对照 · ' : highlight.variant === 'source' ? '原文 · ' : ''}第 {highlight.page} 页</small></span><p>{highlight.text}</p></button>
                    <button className="reader-annotation-remove" aria-label={`删除批注：${highlight.text}`} onClick={() => void removeHighlight(highlight.id)}><Trash2 size={13} /></button>
                  </article>) : <p className="reader-annotation-empty">暂无{option.label}批注</p>}
                </div></Disclosure>
              </div>
            })}
            
          </section>
        </div>
      </aside>}
    </div>
    <footer className="reader-footer"><span><Highlighter size={13} />本页 {pageHighlights.length} 处</span><div><Button variant="ghost" className="icon-button" aria-label="上一页文献" disabled={!pdf || page <= 1} onClick={() => go(page - 1)}><ChevronLeft size={17} /></Button><form onSubmit={(event) => { event.preventDefault(); const number = Number(draftPage); if (Number.isInteger(number)) go(number) }}><input aria-label="文献页码" inputMode="numeric" value={draftPage || String(page)} onChange={(event) => setDraftPage(event.target.value)} onBlur={() => { if (draftPage) { const number = Number(draftPage); if (Number.isInteger(number)) go(number); else setDraftPage('') } }} /><span>/ {pdf?.numPages ?? '…'}</span></form><Button variant="ghost" className="icon-button" aria-label="下一页文献" disabled={!pdf || page >= pdf.numPages} onClick={() => go(page + 1)}><ChevronRight size={17} /></Button></div></footer>
  </>
}

function ReaderSession({ paper, variant, initialPage, initialHighlight }: { paper: Paper; variant: PaperVariant; initialPage?: number; initialHighlight?: string }) {
  const close = () => useLibrary.getState().closeReader()
  const returning = useLibrary(s => s.returningToDesktop)
  return <Dialog open className={`reader-dialog${returning ? ' is-returning' : ''}`} title={paper.title} onOpenChange={open => { if (!open) close() }}><ReaderContent key={variant} paper={paper} variant={variant} initialPage={initialPage} initialHighlight={initialHighlight} setVariant={next => useLibrary.getState().openPaper(paper.id, next)} onClose={close} /></Dialog>
}

export function PdfReader() {
  const reader = useLibrary((state) => state.reader), paper = useLibrary((state) => state.papers.find((item) => item.id === reader?.id))
  if (!reader || !paper) return null
  return <ReaderSession key={paper.id} paper={paper} variant={reader.variant} initialPage={reader.page} initialHighlight={reader.highlightId} />
}
