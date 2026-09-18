import { useEffect, useState } from 'react'
import { Languages } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { Paper } from '../../../shared/types'
import { useLibrary } from '../../stores/library'

export function TranslationQueue({ papers }: { papers: Paper[] }) {
  const progress = useLibrary((state) => state.translationProgress)
  const reduced = useReducedMotion()
  const [now, setNow] = useState(Date.now)
  const active = papers.find((paper) => paper.translationStatus === 'translating')
  const activeId = active?.id
  const queued = papers.filter((paper) => paper.translationStatus === 'queued').length
  const live = active && progress?.paperId === active.id ? progress : null
  useEffect(() => {
    if (!activeId) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [activeId])
  if (!active && !queued) return null
  const elapsed = live ? Math.max(0, Math.floor((now - new Date(live.startedAt).getTime()) / 1000)) : 0
  const elapsedLabel = elapsed >= 60 ? `${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒` : `${elapsed} 秒`
  const percent = live?.percent ?? null
  const stage = live?.stage ?? (active ? '正在启动翻译引擎' : '等待前面的文献完成')
  return <section className="translation-queue" aria-label="文献翻译进度" data-testid="translation-queue">
    <div className="translation-queue-heading"><span className="translation-queue-icon"><Languages size={18} /></span>
      <div className="translation-queue-title"><strong>{active ? '正在翻译' : '翻译排队中'}</strong><span title={active?.title}>{active?.title ?? `${queued} 篇文献等待翻译`}</span></div>
      {active && queued > 0 && <span className="translation-waiting">另有 {queued} 篇排队</span>}
      <span className="translation-percent" title="翻译引擎报告的总体进度，包括解析、翻译和排版。">{percent === null ? <span className="tiny-spinner" /> : `${percent}%`}</span>
    </div>
    <div className="translation-progress-track" role="progressbar" aria-label="当前文献翻译总进度"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? stage : `${stage}，${percent}%`}>
      {percent === null ? <i className="translation-indeterminate" /> : <motion.i initial={false} animate={{ scaleX: percent / 100 }} transition={{ type: 'tween', duration: reduced ? 0 : 0.25, ease: 'easeOut' }} />}
    </div>
    <div className="translation-queue-details"><span className="translation-stage" role="status">{stage}{live?.current !== null && live?.total && live.current !== undefined ? ` · ${Math.round(live.current)} / ${Math.round(live.total)}` : ''}</span>
      <span>{live ? `已用时 ${elapsedLabel}` : '完成后自动添加中英对照版'}</span></div>
  </section>
}
