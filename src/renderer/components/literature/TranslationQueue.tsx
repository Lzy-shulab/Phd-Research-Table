import { useEffect, useId, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, CircleAlert, Languages, Pause, Play, RotateCcw, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { Paper } from '../../../shared/types'
import { useLibrary } from '../../stores/library'
import { libraryAction } from '../../stores/library'
import { Button } from '../ui/button'
import { Disclosure } from '../ui/disclosure'
import { translationSteps, translationStepForStage } from '../../../shared/translation-progress'
import { estimateTranslationMetrics, formatTranslationRemaining } from '../../../shared/translation-metrics'

export function TranslationQueue({ papers }: { papers: Paper[] }) {
  const progress = useLibrary((state) => state.activeTranslationProgress)
  const reduced = useReducedMotion()
  const [now, setNow] = useState(Date.now)
  const detailsId = useId()
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem('translation.details.expanded') === 'true' } catch { return false }
  })
  const activePapers = papers.filter(paper => paper.translationStatus === 'translating')
  const active = activePapers.find(paper => paper.id === progress[0]?.paperId) ?? activePapers[0]
  const activeId = active?.id
  const queuedPapers = papers.filter((paper) => paper.translationStatus === 'queued').sort((a, b) => a.translationOrder - b.translationOrder || a.addedAt.localeCompare(b.addedAt))
  const queued = queuedPapers.length
  const failed = papers.filter((paper) => ['failed', 'interrupted'].includes(paper.translationStatus))
  const paused = useLibrary((state) => state.translationPaused)
  const live = progress.find(item => item.paperId === activeId)
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
  const heading = activePapers.length > 1 ? `${activePapers.length} 篇正在翻译` : active ? '正在翻译' : queued ? (paused ? '翻译队列已暂停' : '翻译排队中') : '翻译需要处理'
  const summary = active?.title ?? (queued ? `${queued} 篇文献等待翻译` : `${failed.length} 篇文献未完成`)
  const step = live?.step ?? translationStepForStage(stage) ?? 'prepare'
  const stepIndex = translationSteps.findIndex(item => item.id === step)
  const metrics = live ? estimateTranslationMetrics(live, now) : null
  return <section className="translation-queue" aria-label="文献翻译进度" data-testid="translation-queue">
    <div className="translation-queue-heading"><span className="translation-queue-icon"><Languages size={18} /></span>
      <div className="translation-queue-title"><strong>{heading}</strong><span title={active?.title}>{summary}</span></div>
      {active && queued > 0 && <span className="translation-waiting">另有 {queued} 篇排队</span>}
      {(active || queued > 0) && <Button variant="ghost" onClick={() => void libraryAction(window.workbench.setTranslationPaused(!paused), paused ? '翻译队列已继续。' : '队列已暂停，正在翻译的文献会继续。')}>
        {paused ? <Play size={14} /> : <Pause size={14} />}{paused ? '继续队列' : '暂停队列'}
      </Button>}
      {active && <Button variant="ghost" className="danger-text" onClick={() => void libraryAction(window.workbench.cancelTranslation(active.id), '已取消翻译。')}><X size={14} />取消本篇</Button>}
      {active && <span className="translation-percent" title="翻译引擎报告的总体进度，包括解析、翻译和排版。">{percent === null ? <span className="tiny-spinner" /> : `${percent}%`}</span>}
      <Button variant="ghost" className="translation-disclosure" aria-expanded={expanded} aria-controls={detailsId} aria-label={expanded ? '收起翻译详情' : '展开翻译详情'} onClick={() => {
        setExpanded(!expanded)
        try { localStorage.setItem('translation.details.expanded', String(!expanded)) } catch { /* Expansion still works for this view. */ }
      }}>{expanded ? '收起' : '详情'}<ChevronDown size={16} /></Button>
    </div>
    {active && <div className="translation-progress-track" role="progressbar" aria-label="当前文献翻译总进度"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? stage : `${stage}，${percent}%`}>
      {percent === null ? <i className="translation-indeterminate" /> : <motion.i initial={false} animate={{ scaleX: percent / 100 }} transition={{ type: 'tween', duration: reduced ? 0 : 0.25, ease: 'easeOut' }} />}
    </div>}
    {(active || queued > 0) && <div className="translation-queue-details"><span className="translation-stage" role="status">{stage}{live?.current !== null && live?.total && live.current !== undefined ? ` · ${Math.round(live.current)} / ${Math.round(live.total)}` : ''}</span>
      {live && <div className="translation-timing">
        {stage === '正在翻译正文' && <span aria-label="当前翻译速度">{metrics ? metrics.perMinute.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) : '—'} 段/分</span>}
        <span aria-label="预计剩余时间" title="按当前阶段最近一分钟的实际进度估算">{metrics ? metrics.remainingSeconds <= 0 ? '本阶段即将完成' : `${step === 'translate' ? '正文' : '本阶段'}剩余${formatTranslationRemaining(metrics.remainingSeconds)}` : '剩余 —'}</span>
        <span>用时 {elapsedLabel}</span>
      </div>}</div>}
    {activePapers.filter(paper => paper.id !== activeId).map(paper => {
      const job = progress.find(item => item.paperId === paper.id)
      return <div className="translation-queue-details" key={paper.id}>
        <span className="translation-stage" title={paper.title}>{paper.title}</span>
        <div className="translation-timing"><span>{job?.stage ?? '正在启动翻译引擎'}{job?.percent != null && ` · ${job.percent}%`}</span>
          <Button variant="ghost" aria-label={`取消翻译 ${paper.title}`} onClick={() => void libraryAction(window.workbench.cancelTranslation(paper.id), '已取消翻译。')}><X size={14} /></Button></div>
      </div>
    })}
    <Disclosure open={expanded} id={detailsId}><div className="translation-expandable">
      {active && <ol className="translation-step-list" aria-label="翻译阶段">{translationSteps.map((item, index) => {
        const state = index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'pending'
        return <li key={item.id} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
          <span className="translation-step-marker">{state === 'done' ? <Check size={13} /> : state === 'current' ? <span className="tiny-spinner" /> : <i />}</span>
          <span><strong>{item.label}</strong><span className="sr-only">{state === 'done' ? '已完成' : state === 'current' ? '进行中' : '等待'}</span></span>
        </li>
      })}</ol>}
    {queuedPapers.length > 0 && <div className="translation-queue-list">
      {queuedPapers.map((paper, index) => <div key={paper.id}><span>{index + 1}</span><strong title={paper.title}>{paper.title}</strong><div><button disabled={index === 0} aria-label={`上移 ${paper.title}`} onClick={async () => { const ids = queuedPapers.map((item) => item.id); [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!]; await libraryAction(window.workbench.reorderTranslations(ids)) }}><ArrowUp size={13} /></button><button disabled={index === queuedPapers.length - 1} aria-label={`下移 ${paper.title}`} onClick={async () => { const ids = queuedPapers.map((item) => item.id); [ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!]; await libraryAction(window.workbench.reorderTranslations(ids)) }}><ArrowDown size={13} /></button><button aria-label={`取消 ${paper.title}`} onClick={() => void libraryAction(window.workbench.cancelTranslation(paper.id), '已移出队列。')}><X size={13} /></button></div></div>)}
    </div>}
    {failed.length > 0 && <details className="translation-failures"><summary><CircleAlert size={14} /><span>{failed.length} 篇未完成翻译</span><span>查看并重试</span></summary>
      <div className="translation-queue-list">{failed.map((paper) => <div key={paper.id} className="translation-failed"><CircleAlert size={14} /><span><strong title={paper.title}>{paper.title}</strong><small>{paper.translationError || '翻译未完成，未生成成功译文。'}</small></span><Button onClick={() => void libraryAction(window.workbench.retryTranslation(paper.id), '已重新加入翻译队列。')}><RotateCcw size={13} />重试</Button></div>)}</div>
    </details>}
    </div></Disclosure>
  </section>
}
