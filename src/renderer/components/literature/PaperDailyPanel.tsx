import { useState } from 'react'
import { BookOpen, Clock3, Download, ExternalLink, EyeOff, Rss, Settings2, Star } from 'lucide-react'
import { libraryAction, useLibrary } from '../../stores/library'
import { Button } from '../ui/button'
import { ArxivSettingsDialog } from './ArxivDailyPanel'
import { PdfReader } from './PdfReader'
import './paper-daily.css'

export function PaperDailyPanel() {
  const daily = useLibrary(state => state.paperDaily)
  const settings = useLibrary(state => state.arxiv.settings)
  const arxivRunning = useLibrary(state => state.arxiv.running)
  const papers = useLibrary(state => state.papers)
  const [configuring, setConfiguring] = useState(false)
  const [favorite, setFavorite] = useState(false)
  const entries = daily.entries.filter(entry => entry.favorite === favorite)
  return <main className="literature-workspace">
    <header className="workspace-header library-header">
      <div className="heading-line"><h1>Paper Daily</h1><span className="library-count">{daily.entries.filter(entry => !entry.favorite).length} 篇待筛选</span></div>
      <div className="workspace-actions">
        <Button variant="ghost" aria-label="检索设置" title="与 Arxiv Daily 共用检索设置" disabled={arxivRunning || daily.running} onClick={() => setConfiguring(true)}><Settings2 size={16} />检索设置</Button>
        {daily.running ? <Button onClick={() => void libraryAction(window.workbench.cancelPaperDaily())}>停止检索</Button>
          : <Button variant="primary" onClick={() => void libraryAction(window.workbench.runPaperDaily())}><Download size={16} />立即检索</Button>}
      </div>
    </header>
    <div className="workspace-body paper-daily-body">
      <section className="arxiv-daily-panel" aria-label="Paper Daily 检索范围">
        <div className="arxiv-daily-intro">
          <span className="arxiv-symbol"><Rss size={20} /></span>
          <div><strong>Hugging Face · Crossref</strong><p>近 {settings.daysBack} 天 · 最多 {settings.maxPerDay} 篇候选</p></div>
        </div>
        <div className="arxiv-daily-bottom"><span><Clock3 size={13} />{settings.enabled ? '每日自动检索' : '自动检索已关闭'}</span>
          {(daily.message || daily.lastRun) && <span role="status">{daily.running && <span className="tiny-spinner" />}{daily.message || `最近检索 ${new Date(daily.lastRun).toLocaleString('zh-CN')}`}</span>}
        </div>
      </section>
      <div className="segmented-control paper-daily-filters" role="group" aria-label="Paper Daily 筛选">
        <button aria-pressed={!favorite} onClick={() => setFavorite(false)}>待筛选</button>
        <button aria-pressed={favorite} onClick={() => setFavorite(true)}>已收藏 {daily.entries.filter(entry => entry.favorite).length}</button>
      </div>
      {entries.length ? <ul className="paper-daily-list" key={String(favorite)} aria-label={favorite ? '已收藏论文' : '待筛选论文'}>{entries.map(entry => {
        const paper = papers.find(item => item.id === entry.paperId)
        const downloading = daily.downloading.includes(entry.id)
        return <li key={entry.id} className="paper-daily-row">
          <div className="paper-daily-text">
            <button className="paper-daily-title" title={entry.title} onClick={() => void libraryAction(window.workbench.paperDailyAction(entry.id, 'open'))}>{entry.title}</button>
            <span title={entry.authors}>{[entry.source, entry.journal, entry.publishedDate, entry.authors].filter(Boolean).join(' · ')}</span>
            {entry.abstract && <details><summary>摘要</summary><p>{entry.abstract}</p></details>}
            {entry.matchReason && <small title={entry.matchReason}>匹配 {entry.matchReason}</small>}
          </div>
          <div className="paper-daily-actions">
            {paper ? <Button onClick={() => useLibrary.getState().openPaper(paper.id, paper.translatedPath ? 'translated' : 'source')}><BookOpen size={15} />阅读 PDF</Button>
              : entry.arxivId || entry.pdfUrl ? <Button disabled={downloading} onClick={() => void libraryAction(window.workbench.paperDailyAction(entry.id, 'download'))}><Download size={15} />{downloading ? '下载中…' : '下载 PDF'}</Button>
                : <Button onClick={() => void libraryAction(window.workbench.paperDailyAction(entry.id, 'open'))}><ExternalLink size={15} />来源</Button>}
            <Button variant="ghost" className="icon-button" aria-label={entry.favorite ? '取消收藏' : '收藏'} aria-pressed={entry.favorite} title={entry.favorite ? '取消收藏' : '收藏'} onClick={() => void libraryAction(window.workbench.paperDailyAction(entry.id, 'favorite'))}><Star size={17} fill={entry.favorite ? 'currentColor' : 'none'} /></Button>
            {!entry.favorite && <Button variant="ghost" className="icon-button" aria-label="忽略" title="忽略" disabled={downloading} onClick={() => void libraryAction(window.workbench.paperDailyAction(entry.id, 'ignore'))}><EyeOff size={17} /></Button>}
          </div>
        </li>
      })}</ul> : <div className="library-empty"><Rss size={25} /><h2>{favorite ? '暂无收藏' : daily.running ? '正在查找相关论文' : '暂无待筛选论文'}</h2></div>}
    </div>
    {configuring && <ArxivSettingsDialog shared onClose={() => setConfiguring(false)} />}
    <PdfReader />
  </main>
}
