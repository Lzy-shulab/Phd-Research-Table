import { useEffect, useRef, useState } from 'react'
import { AlertCircle, FileText, Languages, RefreshCw, Settings2, Sparkles } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import type { Paper, ArxivCandidate, Result } from '../../../shared/types'
import type { PaperOverview } from '../../../shared/overview'
import { extractPaperAbstract } from '../../../domain/overview'
import { openPdf } from '../../lib/pdf'
import { useWorkbench } from '../../stores/workbench'
import { useLibrary } from '../../stores/library'
import { Dialog } from '../ui/dialog'
import { Button } from '../ui/button'

gsap.registerPlugin(useGSAP)

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}
async function readAbstract(id: string) {
  const pdf = await openPdf(id, 'source')
  try {
    let text = ''
    for (let number = 1; number <= Math.min(pdf.numPages, 3); number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      text += '\n' + content.items.filter((item) => 'str' in item).map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('')
      const abstract = extractPaperAbstract(text)
      if (abstract) return abstract
    }
    return ''
  } finally { await pdf.loadingTask.destroy() }
}

export function PaperOverviewDialog({ paper, onClose }: { paper: Paper | ArxivCandidate; onClose: () => void }) {
  const candidate = 'pdfId' in paper
  const [overview, setOverview] = useState<PaperOverview | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [sourceAbstract, setSourceAbstract] = useState(paper.abstract)
  const [needsAbstract, setNeedsAbstract] = useState(false)
  const [stage, setStage] = useState('正在检查本地译文…')
  const content = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  useGSAP(() => {
    if (reducedMotion) return
    gsap.timeline({ defaults: { duration: 0.28, ease: 'power2.out' } })
      .from('.paper-summary-meta', { y: 4, opacity: 0 })
      .from('.paper-overview-section', { y: 7, opacity: 0, stagger: 0.06 }, '-=0.20')
  }, { scope: content, dependencies: [reducedMotion], revertOnUpdate: true })
  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        if (candidate) {
          setStage('正在读取候选标题与摘要译文…')
          const result = unwrap(await window.workbench.generateArxivOverview({ id: paper.id }))
          if (!disposed) { setOverview(result); setSourceAbstract(result.sourceAbstract) }
          return
        }
        const cached = unwrap(await window.workbench.paperOverview(paper.id))
        if (disposed) return
        if (cached) { setOverview(cached); setSourceAbstract(cached.sourceAbstract); return }
        if (!paper.abstract.trim()) setStage('正在从 PDF 提取原文摘要…')
        const source = paper.abstract.trim() || await readAbstract(paper.id).catch(() => '')
        if (disposed) return
        setSourceAbstract(source)
        if (!source) { setNeedsAbstract(true); return }
        setStage('正在翻译标题与摘要…')
        const result = unwrap(await window.workbench.generatePaperOverview({ id: paper.id, sourceAbstract: source }))
        if (!disposed) setOverview(result)
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : '摘要翻译失败，请重试。')
      } finally { if (!disposed) setBusy(false) }
    })()
    return () => { disposed = true }
  }, [paper.id, paper.abstract, candidate])

  const generate = async () => {
    setBusy(true); setError(''); setStage('正在翻译标题与摘要…')
    try {
      const result = unwrap(await (candidate ? window.workbench.generateArxivOverview({ id: paper.id, regenerate: !!overview })
        : window.workbench.generatePaperOverview({ id: paper.id, sourceAbstract, regenerate: !!overview })))
      setOverview(result); setSourceAbstract(result.sourceAbstract); setNeedsAbstract(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '摘要翻译失败，请重试。') }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }} title="中英摘要"  className="paper-overview-dialog">
    <div className="paper-overview-shell" ref={content}>
      <div className="paper-summary-meta"><span>{paper.authors || '作者信息待补充'}</span><span>{[paper.arxivId ? `arXiv:${paper.arxivId}` : paper.journal, paper.publishedDate || ('year' in paper ? paper.year : '')].filter(Boolean).join(' · ')}</span></div>
      {error ? <div className="paper-overview-feedback is-error" role="alert"><AlertCircle size={18} /><div><strong>{overview ? '重新翻译未完成，当前译文仍可阅读' : '摘要翻译未完成'}</strong><p>{error}</p></div></div>
        : busy ? <div className="paper-overview-feedback is-loading" role="status"><span className="tiny-spinner" /><div><strong>{stage}</strong></div><div className="paper-overview-progress" aria-hidden="true"><i className="is-indeterminate" /></div></div>
          : overview ? null
            : <div className="paper-overview-feedback is-source" role="status"><FileText size={18} /><div><strong>需要原文摘要</strong><p>未能从 PDF 中提取摘要，请在英文栏粘贴后翻译。</p></div></div>}
      <div className="paper-overview-scroll">
        <div className="paper-overview-content">
          <section className="paper-overview-section paper-summary-original" aria-label="英文原文">
            <h3><FileText size={16} />英文原文</h3><h2>{paper.title}</h2>
            <h4>Abstract</h4>
            {needsAbstract && !overview ? <div className="paper-overview-source"><label htmlFor="overview-source">粘贴原文摘要</label><textarea id="overview-source" placeholder="在这里粘贴论文的完整摘要…" value={sourceAbstract} onChange={(event) => setSourceAbstract(event.target.value)} maxLength={24000} disabled={busy} /></div>
              : <p>{sourceAbstract || '正在读取原文摘要…'}</p>}
          </section>
          <section className="paper-overview-section paper-summary-translation" aria-label="中文翻译">
            <h3><Languages size={16} />中文翻译</h3>
            {overview ? <><h2>{overview.titleZh}</h2><h4>摘要</h4><p>{overview.abstractZh}</p></>
              : <div className="paper-summary-pending"><span className="summary-pending-icon">{error ? <AlertCircle size={26} /> : <Sparkles size={26} />}</span><h4>{needsAbstract ? '等待原文摘要' : busy ? '正在翻译…' : '暂无译文'}</h4></div>}
          </section>
        </div>
      </div>
      <div className="paper-overview-footer">
        <span className="paper-overview-footnote">{overview ? new Date(overview.generatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
        <div className="dialog-actions">
          <Button className="action-companion" onClick={() => { onClose(); if (!candidate) useLibrary.getState().openPaper(paper.id, 'source') }}><FileText size={14} />{candidate ? '关闭预览' : '阅读原文'}</Button>
          {error && <Button className="action-warm" onClick={() => { onClose(); useWorkbench.getState().openAssistantSettings() }}><Settings2 size={14} />AI 设置</Button>}
          <Button variant="primary" onClick={() => void generate()} disabled={busy || (needsAbstract && !sourceAbstract.trim())}>
            {busy ? <span className="tiny-spinner" /> : overview ? <RefreshCw size={14} /> : <Sparkles size={14} />}{busy ? '翻译中…' : overview ? '重新翻译' : error ? '重试' : '翻译摘要'}
          </Button>
        </div>
      </div>
    </div>
  </Dialog>
}
