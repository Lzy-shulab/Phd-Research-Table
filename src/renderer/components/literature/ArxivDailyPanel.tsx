import { useState } from 'react'
import { Check, ChevronDown, Clock3, EyeOff, FolderOpen, Languages, RefreshCw, Rss, Settings2, Star } from 'lucide-react'
import { ARXIV_LIBRARY_FOLDER, localDay } from '../../../shared/arxiv'
import { arxivSettingsSchema } from '../../../domain/research'
import { libraryAction, useLibrary } from '../../stores/library'
import { Button } from '../ui/button'
import { Dialog } from '../ui/dialog'
import { PaperOverviewDialog } from './PaperOverviewDialog'
import type { ArxivCandidate } from '../../../shared/types'
import { useWorkbench } from '../../stores/workbench'

export function ArxivDailyPanel({ retrieving = false }: { retrieving?: boolean }) {
  const { arxiv, papers } = useLibrary()
  const [settings, setSettings] = useState(false)
  const [expandedCandidates, setExpandedCandidates] = useState<string[]>([])
  const [preview, setPreview] = useState<ArxivCandidate | null>(null)
  const latest = arxiv.runs[0]
  const preparation = arxiv.preparation
  const todayCount = papers.filter((p) => p.collection === 'arxiv' && p.collectedDate === localDay()).length
  return <>
    <section className="arxiv-daily-panel" aria-label="每日 arXiv 检索">
      <div className="arxiv-daily-intro"><span className="arxiv-symbol"><Rss size={22} strokeWidth={1.5} /></span>
        <div><strong>每天，一点新的研究线索</strong><p>近 {arxiv.settings.daysBack} 天 · 最多 {arxiv.settings.maxPerDay} 篇候选 · 中英摘要就绪后供你筛选</p></div>
        <span className="daily-number"><b>{todayCount}</b>今日收录</span>
      </div>
      <div className="arxiv-daily-bottom">
        <span><Clock3 size={13} />{arxiv.settings.enabled ? '每天首次打开自动检索' : '自动检索已关闭'}</span>
        <span><Check size={13} />标题与摘要自动翻译 · 全文按需翻译</span>
        <Button variant="ghost" onClick={() => useLibrary.getState().selectFolder(ARXIV_LIBRARY_FOLDER)}><FolderOpen size={14} />已收藏文献</Button>
        <Button variant="ghost" onClick={() => void libraryAction(window.workbench.revealArxivDirectory())}><FolderOpen size={14} />下载目录</Button>
        <Button variant="ghost" disabled={arxiv.running} onClick={() => setSettings(true)}><Settings2 size={14} />检索设置</Button>
      </div>
    </section>
    {(retrieving || arxiv.running || latest) && <div className={`arxiv-run-status ${latest?.status === 'failed' || latest?.status === 'partial' ? 'run-warning' : ''}`} role="status">
      <div>{retrieving || arxiv.running ? <span className="tiny-spinner" /> : <Clock3 size={14} />}<span>{arxiv.running ? arxiv.progress || '正在检索…' : retrieving ? '正在启动检索…' : arxiv.progress || latest?.message}</span>
        {arxiv.running ? <Button variant="ghost" onClick={() => void libraryAction(window.workbench.cancelArxivDaily())}>停止</Button>
          : !retrieving && <small>{latest && new Date(latest.finishedAt ?? latest.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>}</div>
      {latest && latest.failures.length > 0 && <details><summary>查看 {latest.failures.length} 条下载提示</summary>{latest.failures.map((failure, index) => <p key={index}>{failure}</p>)}</details>}
      {!arxiv.running && arxiv.runs.length > 1 && <details><summary>最近检索记录</summary>{arxiv.runs.slice(0, 7).map((run) => <p key={run.id}>{run.date} · {run.message}</p>)}</details>}
    </div>}
    {(preparation.pending > 0 || preparation.failed > 0) && <section className="arxiv-preparation" aria-label="候选摘要翻译">
      <div className="arxiv-preparation-heading"><Languages size={19} /><div><strong>{arxiv.running ? '正在准备中英标题与摘要' : preparation.failed ? '部分摘要翻译待重试' : '摘要翻译已暂停'}</strong>
        <p>{preparation.ready} 篇可筛选 · {preparation.pending} 篇待完成{preparation.failed > 0 ? ` · ${preparation.failed} 篇未完成` : ''}</p></div></div>
      {preparation.error && <p className="field-error" role="alert">{preparation.error}</p>}
      {!arxiv.running && <div className="arxiv-preparation-actions"><Button onClick={() => void libraryAction(window.workbench.retryArxivTranslations())}><RefreshCw size={14} />{preparation.failed ? '重试未完成翻译' : '继续翻译'}</Button>
        {preparation.failed > 0 && <Button variant="ghost" onClick={() => { useWorkbench.getState().setSection('settings'); setTimeout(() => document.getElementById('assistant-settings')?.scrollIntoView({ block: 'start' }), 150) }}>AI 设置</Button>}</div>}
    </section>}
    {arxiv.candidates.length > 0 && <section className="arxiv-candidates" aria-label="arXiv 候选论文">
      <header className="arxiv-candidates-heading">
        <div><span className="arxiv-queue-icon"><Rss size={18} strokeWidth={1.6} /></span><div><h2>待筛选候选 <span>{arxiv.candidates.length}</span></h2><p>中英标题与摘要已就绪；收藏后下载到「我的文件夹 · Arvix」。</p></div></div>
        <span className="arxiv-queue-status">中英对照</span>
      </header>
      <div className="arxiv-candidate-list">
        {arxiv.candidates.map((candidate, index) => {
          const expanded = expandedCandidates.includes(candidate.id)
          const download = arxiv.downloads.find(job => job.id === candidate.id)
          const busy = !!download && download.status !== 'failed'
          const expandable = candidate.abstract.trim().length > 220 || (candidate.overview?.abstractZh.length ?? 0) > 110
          const titleId = `arxiv-candidate-${candidate.id.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`
          return <article key={candidate.id} className={candidate.favorite ? 'is-favorite' : ''} aria-labelledby={titleId} onClick={(event) => {
            if (!(event.target as HTMLElement).closest('button, a, input, summary')) setPreview(candidate)
          }}>
            <header className="arxiv-candidate-heading">
              <span className="arxiv-candidate-number">{String(index + 1).padStart(2, '0')}</span>
              <div><h3 id={titleId}><button className="arxiv-candidate-preview" aria-label={`预览中英摘要 ${candidate.title}`} onClick={() => setPreview(candidate)}>{candidate.overview?.titleZh}</button></h3><p className="arxiv-candidate-source-title" lang="en">{candidate.title}</p><p className="arxiv-candidate-meta"><span>{candidate.authors || '作者待补充'}</span><time dateTime={candidate.publishedDate}>{candidate.publishedDate}</time></p></div>
              {busy && <span className="arxiv-favorite-state" role="status"><span className="tiny-spinner" />{download.status === 'queued' ? '等待下载' : '正在下载'}</span>}
            </header>
            <div className="arxiv-candidate-abstract">
              <div className="arxiv-bilingual-abstract"><section aria-label="中文摘要"><span>中文摘要</span><p className={expanded ? 'is-expanded' : ''}>{candidate.overview?.abstractZh}</p></section><section aria-label="英文摘要"><span>Abstract</span><p lang="en" className={expanded ? 'is-expanded' : ''}>{candidate.abstract}</p></section></div>
              {expandable && <button aria-expanded={expanded} onClick={() => setExpandedCandidates((current) => expanded ? current.filter((id) => id !== candidate.id) : [...current, candidate.id])}>{expanded ? '收起摘要' : '展开摘要'}<ChevronDown size={14} /></button>}
            </div>
            <div className="arxiv-match-reason"><span>匹配线索</span><strong>{candidate.matchReason.replace(/^匹配[：:]\s*/, '')}</strong></div>
            <footer className="arxiv-candidate-actions">
              {download?.status === 'failed' && <span className="arxiv-download-error" role="alert">{download.error}</span>}
              <Button variant="primary" disabled={busy} onClick={() => void libraryAction(window.workbench.arxivCandidateAction(candidate.id, 'favorite'), '已收藏并下载到「我的文件夹 · Arvix」。')}><Star size={14} fill={candidate.favorite ? 'currentColor' : 'none'} />{busy ? download.status === 'queued' ? '已排队' : '下载中…' : download?.status === 'failed' ? '重试下载' : candidate.favorite ? '继续下载' : '收藏'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => void libraryAction(window.workbench.arxivCandidateAction(candidate.id, 'ignore'))}><EyeOff size={14} />忽略</Button>
            </footer>
          </article>
        })}
      </div>
    </section>}
    {!arxiv.running && !arxiv.candidates.length && !preparation.pending && !preparation.failed && <div className="arxiv-discovery-empty"><Rss size={28} strokeWidth={1.5} /><h2>{latest ? '本轮没有待筛选候选' : '从下一篇新论文开始'}</h2><p>{latest ? '可调整研究关键词重新检索，已收藏的文献在 Arvix 文件夹中。' : '点击立即检索，标题与摘要翻译完成后会显示在这里。'}</p><Button onClick={() => useLibrary.getState().selectFolder(ARXIV_LIBRARY_FOLDER)}><FolderOpen size={15} />阅读已收藏文献</Button></div>}
    {preview && <PaperOverviewDialog key={preview.id} paper={preview} onClose={() => setPreview(null)} />}
    {settings && <ArxivSettingsDialog onClose={() => setSettings(false)} />}
  </>
}
function ArxivSettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useLibrary((s) => s.arxiv.settings)
  const [draft, setDraft] = useState(settings)
  const [directions, setDirections] = useState(settings.directions.join('\n'))
  const [excludedKeywords, setExcludedKeywords] = useState(settings.excludedKeywords.join('\n'))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <Dialog open title="Arxiv Daily 设置" description="检索后自动翻译标题与摘要，使用设置中的 AI 助手模型；收藏后下载原文。" onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <form className="project-form" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return
      const parsed = arxivSettingsSchema.safeParse({ ...draft, directions: directions.split('\n').map((line) => line.trim()).filter(Boolean), excludedKeywords: excludedKeywords.split('\n').map((line) => line.trim()).filter(Boolean) })
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查设置。'); return }
      setBusy(true); setError('')
      try {
        const result = await window.workbench.saveArxivSettings(parsed.data)
        if (!result.ok) { setError(result.error.message); return }
        await useLibrary.getState().load(); onClose()
      } catch { setError('设置未能保存，请重试。') } finally { setBusy(false) }
    }}>
      <label className="import-translation"><Clock3 size={20} /><span><strong>每日自动检索</strong><small>每天首次打开执行；持续运行时跨天自动执行</small></span>
        <input type="checkbox" role="switch" aria-label="每日自动检索" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /></label>
      <div className="field-pair"><label className="field">回看天数<input type="number" min={1} max={90} required value={draft.daysBack} onChange={(e) => setDraft({ ...draft, daysBack: Number(e.target.value) })} /></label>
        <label className="field">候选展示上限<input type="number" min={1} max={50} required value={draft.maxPerDay} onChange={(e) => setDraft({ ...draft, maxPerDay: Number(e.target.value) })} /></label></div>
      <label className="field">研究关键词<textarea rows={8} aria-label="研究关键词" value={directions} onChange={(e) => setDirections(e.target.value)} required /></label>
      <label className="field">排除关键词<textarea rows={4} aria-label="排除关键词" value={excludedKeywords} onChange={(e) => setExcludedKeywords(e.target.value)} placeholder="每行一个；标题或摘要包含时排除" /></label>
      <p className="field-hint">每行一个英文方向，例如 hyperspectral fusion。同一方向需同时匹配多个词组时，用 AND 连接，例如 Mamba AND remote sensing。无新论文时不会凑满数量。</p>
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="dialog-actions"><Button onClick={onClose} disabled={busy}>取消</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? '保存中…' : '保存检索设置'}</Button></div>
    </form>
  </Dialog>
}
