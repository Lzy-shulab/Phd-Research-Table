import { useEffect, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import type { Paper } from '../../../shared/types'
import { openPdf } from '../../lib/pdf'
import { useLibrary } from '../../stores/library'

const covers = new Map<string, string>()
const pending = new Map<string, Promise<string>>()
let coverQueue: Promise<void> = Promise.resolve()
function enqueueCover(paper: Paper) {
  const task = coverQueue.then(() => renderCover(paper))
  coverQueue = task.then(() => undefined, () => undefined)
  return task
}
async function renderCover(paper: Paper) {
  const document = await openPdf(paper.id, 'source')
  try {
    const page = await document.getPage(1)
    const canvas = window.document.createElement('canvas')
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 540 / base.width })
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, viewport }).promise
    const url = canvas.toDataURL('image/jpeg', 0.86)
    if (covers.size > 150) covers.delete(covers.keys().next().value!)
    covers.set(paper.id, url)
    const current = useLibrary.getState().papers.find((p) => p.id === paper.id)
    if (current && !current.pageCount) {
      await window.workbench.updatePaper(paper.id, { pageCount: document.numPages })
    }
    return url
  } finally { await document.loadingTask.destroy() }
}

export function PdfCover({ paper }: { paper: Paper }) {
  const host = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState(covers.get(paper.id) ?? '')
  const [error, setError] = useState('')
  useEffect(() => {
    if (url) return
    let active = true
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      let promise = pending.get(paper.id)
      if (!promise) {
        promise = enqueueCover(paper)
        pending.set(paper.id, promise)
        void promise.finally(() => pending.delete(paper.id)).catch(() => undefined)
      }
      void promise.then((value) => { if (active) setUrl(value) }).catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '首页暂时无法预览')
      })
    }, { rootMargin: '240px' })
    if (host.current) observer.observe(host.current)
    return () => { active = false; observer.disconnect() }
  }, [paper, url])
  return <div className="pdf-cover" ref={host}>
    {url ? <img src={url} alt={`${paper.title} 的 PDF 首页`} draggable={false} />
      : <div className="pdf-cover-placeholder"><FileText size={34} strokeWidth={1.1} /><span title={error}>{error ? '首页暂不可用' : 'PDF'}</span></div>}
  </div>
}
