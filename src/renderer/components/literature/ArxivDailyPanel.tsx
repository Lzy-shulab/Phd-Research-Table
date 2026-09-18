import { useState } from 'react'
import { Check, Clock3, FolderOpen, Rss, Settings2 } from 'lucide-react'
import { localDay } from '../../../shared/arxiv'
import { arxivSettingsSchema } from '../../../domain/research'
import { libraryAction, useLibrary } from '../../stores/library'
import { Button } from '../ui/button'
import { Dialog } from '../ui/dialog'

export function ArxivDailyPanel() {
  const { arxiv, papers } = useLibrary()
  const [settings, setSettings] = useState(false)
  const latest = arxiv.runs[0]
  const todayCount = papers.filter((p) => p.collection === 'arxiv' && p.collectedDate === localDay()).length
  return <>
    <section className="arxiv-daily-panel" aria-label="每日 arXiv 检索">
      <div className="arxiv-daily-intro"><span className="arxiv-symbol"><Rss size={22} strokeWidth={1.5} /></span>
        <div><strong>每天，一点新的研究线索</strong><p>近 {arxiv.settings.daysBack} 天 · 每日最多 {arxiv.settings.maxPerDay} 篇 · 按研究关键词匹配排序</p></div>
        <span className="daily-number"><b>{todayCount}</b>今日收录</span>
      </div>
      <div className="arxiv-daily-bottom">
        <span><Clock3 size={13} />{arxiv.settings.enabled ? '每天首次打开自动检索' : '自动检索已关闭'}</span>
        <span><Check size={13} />PDF 本地保存 · 按需翻译</span>
        <Button variant="ghost" onClick={() => void libraryAction(window.workbench.revealArxivDirectory())}><FolderOpen size={14} />下载目录</Button>
        <Button variant="ghost" disabled={arxiv.running} onClick={() => setSettings(true)}><Settings2 size={14} />检索设置</Button>
      </div>
    </section>
    {(arxiv.running || latest) && <div className={`arxiv-run-status ${latest?.status === 'failed' || latest?.status === 'partial' ? 'run-warning' : ''}`} role="status">
      <div>{arxiv.running ? <span className="tiny-spinner" /> : <Clock3 size={14} />}<span>{arxiv.progress || latest?.message}</span>
        {arxiv.running ? <Button variant="ghost" onClick={() => void libraryAction(window.workbench.cancelArxivDaily())}>停止</Button>
          : <small>{latest && new Date(latest.finishedAt ?? latest.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>}</div>
      {latest && latest.failures.length > 0 && <details><summary>查看 {latest.failures.length} 条下载提示</summary>{latest.failures.map((failure, index) => <p key={index}>{failure}</p>)}</details>}
      {!arxiv.running && arxiv.runs.length > 1 && <details><summary>最近检索记录</summary>{arxiv.runs.slice(0, 7).map((run) => <p key={run.id}>{run.date} · {run.message}</p>)}</details>}
    </div>}
    {settings && <ArxivSettingsDialog onClose={() => setSettings(false)} />}
  </>
}
function ArxivSettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useLibrary((s) => s.arxiv.settings)
  const [draft, setDraft] = useState(settings)
  const [directions, setDirections] = useState(settings.directions.join('\n'))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <Dialog open title="Arxiv Daily 设置" description="只检索 arXiv。下载后保留原文，需要时再点击卡片上的翻译。" onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <form className="project-form" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return
      const parsed = arxivSettingsSchema.safeParse({ ...draft, directions: directions.split('\n').map((line) => line.trim()).filter(Boolean) })
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
        <label className="field">每日下载上限<input type="number" min={1} max={50} required value={draft.maxPerDay} onChange={(e) => setDraft({ ...draft, maxPerDay: Number(e.target.value) })} /></label></div>
      <label className="field">研究关键词<textarea rows={8} aria-label="研究关键词" value={directions} onChange={(e) => setDirections(e.target.value)} required /></label>
      <p className="field-hint">每行一个英文方向，例如 hyperspectral fusion。同一方向需同时匹配多个词组时，用 AND 连接，例如 Mamba AND remote sensing。无新论文时不会凑满数量。</p>
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="dialog-actions"><Button onClick={onClose} disabled={busy}>取消</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? '保存中…' : '保存检索设置'}</Button></div>
    </form>
  </Dialog>
}
