import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, CircleAlert, Languages, Pause, Play, RotateCcw, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { Paper } from '../../../shared/types'
import { useLibrary } from '../../stores/library'
import { libraryAction } from '../../stores/library'
import { Button } from '../ui/button'

export function TranslationQueue({ papers }: { papers: Paper[] }) {
  const progress = useLibrary((state) => state.translationProgress)
  const reduced = useReducedMotion()
  const [now, setNow] = useState(Date.now)
  const active = papers.find((paper) => paper.translationStatus === 'translating')
  const activeId = active?.id
  const queuedPapers = papers.filter((paper) => paper.translationStatus === 'queued').sort((a, b) => a.translationOrder - b.translationOrder || a.addedAt.localeCompare(b.addedAt))
  const queued = queuedPapers.length
  const failed = papers.filter((paper) => ['failed', 'interrupted'].includes(paper.translationStatus))
  const paused = useLibrary((state) => state.translationPaused)
  const live = active && progress?.paperId === active.id ? progress : null
  useEffect(() => {
    if (!activeId) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [activeId])
  if (!active && !queued && !failed.length) return null
  const elapsed = live ? Math.max(0, Math.floor((now - new Date(live.startedAt).getTime()) / 1000)) : 0
  const elapsedLabel = elapsed >= 60 ? `${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒` : `${elapsed} 秒`
  const percent = live?.percent ?? null
  const stage = live?.stage ?? (active ? '正在启动翻译引擎' : queued ? (paused ? '队列已暂停' : '等待翻译引擎就绪') : '需要处理失败的翻译')
  const heading = active ? '正在翻译' : queued ? (paused ? '翻译队列已暂停' : '翻译排队中') : '翻译需要处理'
  const summary = active?.title ?? (queued ? `${queued} 篇文献等待翻译` : `${failed.length} 篇文献未完成`)
  return <section className="translation-queue" aria-label="文献翻译进度" data-testid="translation-queue">
    <div className="translation-queue-heading"><span className="translation-queue-icon"><Languages size={18} /></span>
      <div className="translation-queue-title"><strong>{heading}</strong><span title={active?.title}>{summary}</span></div>
      {active && queued > 0 && <span className="translation-waiting">另有 {queued} 篇排队</span>}
      {(active || queued > 0) && <Button variant="ghost" onClick={() => void libraryAction(window.workbench.setTranslationPaused(!paused), paused ? '翻译队列已继续。' : '队列已暂停；当前篇完成后停止。')}>
        {paused ? <Play size={14} /> : <Pause size={14} />}{paused ? '继续队列' : '暂停队列'}
      </Button>}
      {active && <Button variant="ghost" className="danger-text" onClick={() => void libraryAction(window.workbench.cancelTranslation(active.id), '已取消当前翻译；原文未改动。')}><X size={14} />取消本篇</Button>}
      {active && <span className="translation-percent" title="翻译引擎报告的总体进度，包括解析、翻译和排版。">{percent === null ? <span className="tiny-spinner" /> : `${percent}%`}</span>}
    </div>
    {active && <div className="translation-progress-track" role="progressbar" aria-label="当前文献翻译总进度"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? stage : `${stage}，${percent}%`}>
      {percent === null ? <i className="translation-indeterminate" /> : <motion.i initial={false} animate={{ scaleX: percent / 100 }} transition={{ type: 'tween', duration: reduced ? 0 : 0.25, ease: 'easeOut' }} />}
    </div>}
    {(active || queued > 0) && <div className="translation-queue-details"><span className="translation-stage" role="status">{stage}{live?.current !== null && live?.total && live.current !== undefined ? ` · ${Math.round(live.current)} / ${Math.round(live.total)}` : ''}</span>
      <span>{live ? `已用时 ${elapsedLabel}` : '完成后自动添加中英对照版'}</span></div>}
    {queuedPapers.length > 0 && <div className="translation-queue-list">
      {queuedPapers.map((paper, index) => <div key={paper.id}><span>{index + 1}</span><strong title={paper.title}>{paper.title}</strong><div><button disabled={index === 0} aria-label={`上移 ${paper.title}`} onClick={async () => { const ids = queuedPapers.map((item) => item.id); [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!]; await libraryAction(window.workbench.reorderTranslations(ids)) }}><ArrowUp size={13} /></button><button disabled={index === queuedPapers.length - 1} aria-label={`下移 ${paper.title}`} onClick={async () => { const ids = queuedPapers.map((item) => item.id); [ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!]; await libraryAction(window.workbench.reorderTranslations(ids)) }}><ArrowDown size={13} /></button><button aria-label={`取消 ${paper.title}`} onClick={() => void libraryAction(window.workbench.cancelTranslation(paper.id), '已从翻译队列移除；原文未改动。')}><X size={13} /></button></div></div>)}
    </div>}
    {failed.length > 0 && <details className="translation-failures"><summary><CircleAlert size={14} /><span>{failed.length} 篇未完成翻译</span><span>查看并重试</span></summary>
      <div className="translation-queue-list">{failed.map((paper) => <div key={paper.id} className="translation-failed"><CircleAlert size={14} /><span><strong title={paper.title}>{paper.title}</strong><small>{paper.translationError || '翻译未完成，未生成成功译文。'}</small></span><Button onClick={() => void libraryAction(window.workbench.retryTranslation(paper.id), '已重新加入翻译队列。')}><RotateCcw size={13} />重试</Button></div>)}</div>
    </details>}
  </section>
}
