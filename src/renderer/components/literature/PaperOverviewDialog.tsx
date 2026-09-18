import { useEffect, useState } from 'react'
import { FileText, RefreshCw, Sparkles } from 'lucide-react'
import type { Paper, Result } from '../../../shared/types'
import type { PaperOverview } from '../../../shared/overview'
import { extractPaperAbstract } from '../../../domain/overview'
import { openPdf } from '../../lib/pdf'
import { useWorkbench } from '../../stores/workbench'
import { useLibrary } from '../../stores/library'
import { Dialog } from '../ui/dialog'
import { Button } from '../ui/button'

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

export function PaperOverviewDialog({ paper, onClose }: { paper: Paper; onClose: () => void }) {
  const [overview, setOverview] = useState<PaperOverview | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [sourceAbstract, setSourceAbstract] = useState(paper.abstract)
  const [needsAbstract, setNeedsAbstract] = useState(false)
  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const cached = unwrap(await window.workbench.paperOverview(paper.id))
        if (disposed) return
        if (cached) { setOverview(cached); setSourceAbstract(cached.sourceAbstract); return }
        const source = paper.abstract.trim() || await readAbstract(paper.id).catch(() => '')
        if (disposed) return
        setSourceAbstract(source)
        if (!source) { setNeedsAbstract(true); return }
        const result = unwrap(await window.workbench.generatePaperOverview({ id: paper.id, sourceAbstract: source }))
        if (!disposed) setOverview(result)
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : '摘要翻译失败，请重试。')
      } finally { if (!disposed) setBusy(false) }
    })()
    return () => { disposed = true }
  }, [paper.id, paper.abstract])

  const generate = async () => {
    setBusy(true); setError('')
    try {
      const result = unwrap(await window.workbench.generatePaperOverview({ id: paper.id, sourceAbstract, regenerate: !!overview }))
      setOverview(result); setSourceAbstract(result.sourceAbstract); setNeedsAbstract(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '摘要翻译失败，请重试。') }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }} title="中英摘要" description="对照阅读论文标题与摘要，中文由 AI 翻译。" className="paper-overview-dialog">
    <div className="paper-summary-meta"><span>{paper.authors}</span><span>{[paper.arxivId ? `arXiv:${paper.arxivId}` : paper.journal, paper.publishedDate || paper.year].filter(Boolean).join(' · ')}</span></div>
    <div className="paper-overview-content">
      <section className="paper-overview-section paper-summary-original" aria-label="英文原文">
        <h3>英文原文 <span>Original</span></h3><h2>{paper.title}</h2>
        <h4>Abstract</h4><p>{sourceAbstract || (busy ? '正在读取原文摘要…' : '尚未取得原文摘要。')}</p>
      </section>
      <section className="paper-overview-section paper-summary-translation" aria-label="中文翻译">
        <h3>中文翻译 <span>中文</span></h3>
        {overview ? <><h2>{overview.titleZh}</h2><h4>摘要</h4><p>{overview.abstractZh}</p></>
          : <p className="paper-summary-pending">{busy ? '正在翻译标题与摘要…' : '译文尚未生成，可在下方重试。'}</p>}
      </section>
    </div>
    {busy && <div className="paper-overview-loading" role="status"><span className="tiny-spinner" />正在翻译标题与摘要…</div>}
    {needsAbstract && !overview && <div className="paper-overview-source"><p>未能从 PDF 中可靠提取原文摘要，请粘贴论文的摘要后翻译。</p><label htmlFor="overview-source">原文摘要</label><textarea id="overview-source" value={sourceAbstract} onChange={(event) => setSourceAbstract(event.target.value)} maxLength={24000} disabled={busy} /></div>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="dialog-actions">
      <Button onClick={() => { onClose(); useLibrary.getState().openPaper(paper.id, 'source') }}><FileText size={14} />阅读原文</Button>
      {error && <Button onClick={() => { onClose(); useWorkbench.getState().setSection('settings'); setTimeout(() => document.getElementById('assistant-settings')?.scrollIntoView({ block: 'start' }), 150) }}>AI 设置</Button>}
      {!busy && <Button variant={overview ? 'ghost' : 'primary'} onClick={() => void generate()} disabled={needsAbstract && !sourceAbstract.trim()}>
        {overview ? <RefreshCw size={14} /> : <Sparkles size={14} />}{overview ? '重新翻译' : error ? '重试' : '翻译摘要'}
      </Button>}
    </div>
  </Dialog>
}
