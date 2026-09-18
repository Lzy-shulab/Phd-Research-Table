import { useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { BookOpen, BookOpenText, Check, FileText, FolderOpen, Languages, MoreHorizontal, Plus, RefreshCw, Search, Settings2, Upload, Download } from 'lucide-react'
import type { Paper } from '../../../shared/types'
import { libraryAction, useLibrary } from '../../stores/library'
import { useWorkbench } from '../../stores/workbench'
import { Button } from '../ui/button'
import { PdfCover } from './PdfCover'
import { PdfReader } from './PdfReader'
import { PaperDialog } from './PaperDialog'
import { ImportDialog } from './ImportDialog'
import { TranslationSettings } from './TranslationSettings'
import { ArxivDailyPanel } from './ArxivDailyPanel'
import { requestMetadata, useMetadataJobs } from '../../lib/metadata'
import { TranslationQueue } from './TranslationQueue'
import { PaperOverviewDialog } from './PaperOverviewDialog'

function PaperCard({ paper, folder, onEdit, onOverview, onTranslate }: { paper: Paper; folder?: string; onEdit: () => void; onOverview: () => void; onTranslate: () => void }) {
  const identifying = useMetadataJobs((state) => !!state.ids[paper.id])
  const live = useLibrary((state) => state.translationProgress?.paperId === paper.id ? state.translationProgress : null)
  const reduced = useReducedMotion()
  const read = Math.max(paper.readPage, paper.translatedReadPage)
  const progress = paper.readProgress
  const translating = ['queued', 'translating'].includes(paper.translationStatus)
  const failed = ['failed', 'interrupted'].includes(paper.translationStatus)
  const open = () => paper.collection === 'arxiv' ? onOverview() : useLibrary.getState().openPaper(paper.id, paper.translatedPath ? 'translated' : 'source')
  const translationLabel = paper.translationStatus === 'queued' ? '等待翻译' : paper.translationStatus === 'translating'
    ? `翻译中${live?.percent != null ? ` ${live.percent}%` : ''}` : failed ? '翻译重试' : '未翻译'
  return <motion.article className="paper-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} data-testid="paper-card">
    <div className="paper-cover-area">
      <button className="paper-cover-button" onClick={open} aria-label={`${paper.collection === 'arxiv' ? '查看中英摘要' : '阅读'} ${paper.title}`}><PdfCover paper={paper} /></button>
      <span className="paper-page-badge"><BookOpen size={12} />{read ? `${read} / ${paper.pageCount || '…'}` : '未读'}</span>
      <button className="paper-more" aria-label={`编辑文献 ${paper.title}`} onClick={onEdit}><MoreHorizontal size={18} /></button>
    </div>
    <div className="paper-card-body">
      <button className="paper-title" onClick={open} title={paper.title}>{paper.title}</button>
      <p className="paper-authors" title={paper.authors}>{paper.authors || '作者信息待补充'}</p>
      <div className="paper-tags"><span title={paper.journal || folder || '未分类'}><FolderOpen size={11} />{paper.journal || folder || '未分类'}</span>{paper.year && <small>{paper.year}</small>}</div>
      {paper.collection === 'library' && <div className="paper-metadata-row" title={paper.metadataMessage}>
        <span>{identifying ? <><span className="tiny-spinner" />正在识别资料…</> : paper.metadataStatus === 'ready' ? <><Check size={11} />{paper.metadataSource || '资料已读取'}</> : paper.metadataStatus === 'failed' ? '资料识别未完成' : paper.metadataStatus === 'partial' ? '部分信息待补充' : '资料待识别'}</span>
        <button disabled={identifying} aria-label={`自动识别文献信息 ${paper.title}`} onClick={() => void requestMetadata(paper)}><RefreshCw size={11} />{paper.metadataCheckedAt ? '重新识别' : '识别信息'}</button>
      </div>}
      {paper.arxivId && <p className="arxiv-paper-id" title={paper.abstract}>arXiv:{paper.arxivId} · {paper.publishedDate}</p>}
      {failed && <p className="paper-translation-error">{paper.translationError}</p>}
      <div className="paper-card-actions">
        <button onClick={() => useLibrary.getState().openPaper(paper.id, 'source')}><FileText size={13} />原文</button>
        {paper.translatedPath ? <button className="bilingual-button" title="已翻译，打开全文中英对照译文" onClick={() => useLibrary.getState().openPaper(paper.id, 'translated')}><Languages size={13} />已翻译</button>
          : <button disabled={translating} title={translating ? '全文翻译处理中' : failed ? paper.translationError : '未翻译，点击生成全文中英对照译文'} onClick={onTranslate}>{translating ? <span className="tiny-spinner" /> : <Languages size={13} />}{translationLabel}</button>}
        <button onClick={onOverview}><BookOpenText size={13} />中英摘要</button>
      </div>
    </div>
    <div className="paper-progress-footer" title="按最远阅读位置记录，返回前面的页面不会降低进度。"><div><span>{progress ? '阅读进度' : '尚未开始阅读'}</span><strong>{progress}%</strong></div>
      <div className="paper-progress-track" role="progressbar" aria-label={`${paper.title} 阅读进度`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <motion.i initial={false} animate={{ scaleX: progress / 100 }} transition={{ type: 'spring', bounce: 0, duration: reduced ? 0 : 0.4 }} /></div>
    </div>
  </motion.article>
}

export function LiteratureWorkspace() {
  const folderId = useLibrary((s) => s.folderId)
  return <LiteratureContent key={folderId} />
}
function LiteratureContent() {
  const library = useLibrary()
  const isArxiv = library.folderId === 'arxiv'
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [day, setDay] = useState('all')
  const [importing, setImporting] = useState<{ paths?: string[] } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [overviewId, setOverviewId] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const folder = library.folders.find((f) => f.id === library.folderId)
  const included = new Set([library.folderId])
  for (let i = 0; i < library.folders.length; i++) for (const f of library.folders) if (f.parentId && included.has(f.parentId)) included.add(f.id)
  const scoped = library.papers.filter((p) => isArxiv ? p.collection === 'arxiv' : p.collection === 'library' && (library.folderId === 'all' || (library.folderId === 'unfiled' ? !p.folderId : p.folderId && included.has(p.folderId))))
  const filtered = scoped.filter((paper) => {
    if (isArxiv && day !== 'all' && paper.collectedDate !== day) return false
    if (!`${paper.title} ${paper.authors} ${paper.journal} ${paper.notes}`.toLowerCase().includes(query.trim().toLowerCase())) return false
    const page = Math.max(paper.readPage, paper.translatedReadPage)
    if (filter === 'unread') return !page
    if (filter === 'reading') return page > 0 && (!paper.pageCount || page < paper.pageCount)
    if (filter === 'read') return paper.pageCount > 0 && page >= paper.pageCount
    if (filter === 'translated') return paper.translationStatus === 'ready'
    if (filter === 'translating') return ['queued', 'translating'].includes(paper.translationStatus)
    if (filter === 'failed') return ['failed', 'interrupted'].includes(paper.translationStatus)
    return true
  }).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title)
    : sort === 'recent' ? (b.lastReadAt ?? '').localeCompare(a.lastReadAt ?? '') : b.addedAt.localeCompare(a.addedAt))
  const paper = library.papers.find((p) => p.id === editing)
  const overviewPaper = library.papers.find((p) => p.id === overviewId)
  const translate = async (paper: Paper) => {
    const result = await window.workbench.translationHealth()
    if (!result.ok) { useWorkbench.getState().notify(result.error.message); return }
    if (!result.data.installed || !result.data.configured) {
      setSettings(true)
      useWorkbench.getState().notify(result.data.message, 'info')
      return
    }
    await libraryAction(window.workbench.retryTranslation(paper.id))
  }
  return <main className="literature-workspace" onDragEnter={(event) => {
    if (isArxiv || !event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current++; setDragging(true)
  }} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
    onDragLeave={(event) => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }} onDrop={(event) => {
      event.preventDefault(); dragDepth.current = 0; setDragging(false)
      if (isArxiv) { useWorkbench.getState().notify('手动添加 PDF 请进入全部文献或我的文件夹。', 'info'); return }
      const files = Array.from(event.dataTransfer.files)
      const paths = files.filter((file) => /\.pdf$/i.test(file.name)).map((file) => window.workbench.droppedFilePath(file)).filter(Boolean)
      if (paths.length) setImporting({ paths })
      else useWorkbench.getState().notify('请拖入本机上的 PDF 文献文件。')
    }}>
    <header className="workspace-header library-header"><div><div className="workspace-breadcrumb">文献阅读<span>/</span>{isArxiv ? 'Arxiv Daily' : folder?.name ?? (library.folderId === 'unfiled' ? '未分类' : '全部文献')}</div>
      <div className="heading-line"><h1>{isArxiv ? 'Arxiv Daily' : folder?.name ?? (library.folderId === 'unfiled' ? '未分类' : '文献库')}</h1><span className="library-count">{scoped.length} 篇</span></div>
      <p>{isArxiv ? '与研究方向相关的新论文，留在这里慢慢读。' : '让每一次阅读，留下下一步研究的线索。'}</p></div>
      <div className="workspace-actions"><Button variant="ghost" className="icon-button" aria-label="文献翻译设置" onClick={() => setSettings(true)}><Settings2 size={18} /></Button>
        {isArxiv ? <Button variant="primary" disabled={library.arxiv.running} onClick={() => void libraryAction(window.workbench.runArxivDaily())}><Download size={16} />{library.arxiv.running ? '检索下载中…' : '立即检索'}</Button>
          : <Button variant="primary" onClick={() => setImporting({})}><Plus size={17} />添加文献</Button>}</div>
    </header>
    <div className="library-toolbar"><label className="library-search"><Search size={17} /><input aria-label="搜索文献" placeholder="搜索标题、作者、期刊或笔记" value={query} onChange={(e) => setQuery(e.target.value)} />
      {query && <button aria-label="清除文献搜索" onClick={() => setQuery('')}>×</button>}</label>
      <select aria-label="文献状态筛选" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部状态</option><option value="unread">未读</option><option value="reading">阅读中</option><option value="read">已读完</option><option value="translated">已有中英对照</option><option value="translating">翻译中</option><option value="failed">翻译待重试</option></select>
      <select aria-label="文献排序" value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">最近添加</option><option value="recent">最近阅读</option><option value="title">标题排序</option></select>
      {isArxiv && <select aria-label="收录日期" value={day} onChange={(e) => setDay(e.target.value)}><option value="all">全部收录日期</option>{[...new Set(scoped.map((p) => p.collectedDate))].sort().reverse().map((date) => <option key={date}>{date}</option>)}</select>}
    </div>
    <TranslationQueue papers={scoped} />
    <div className="library-scroll">
      {isArxiv && <ArxivDailyPanel />}
      {library.loadError ? <div className="empty-state"><p role="alert">{library.loadError}</p><Button onClick={() => void library.load()}><RefreshCw size={15} />重试</Button></div>
        : !library.loaded ? <div className="empty-state">正在读取文献库…</div>
        : filtered.length ? <div className="paper-grid">{filtered.map((item) => <PaperCard key={item.id} paper={item} folder={library.folders.find((f) => f.id === item.folderId)?.name} onEdit={() => setEditing(item.id)} onOverview={() => setOverviewId(item.id)} onTranslate={() => void translate(item)} />)}</div>
        : <div className="library-empty"><div className="empty-paper-stack"><FileText size={46} strokeWidth={1} /></div>
          <h2>{scoped.length ? '没有找到符合条件的文献' : isArxiv ? '下一篇研究线索，从这里开始' : '从一篇值得读的文献开始'}</h2>
          <p>{scoped.length ? '调整搜索或筛选，继续寻找研究线索。' : isArxiv ? '检索结果与下载的 PDF 会独立收录在 Arxiv Daily。' : '拖入 PDF，或添加文献。按期刊整理，随时阅读中英对照。'}</p>
          {scoped.length ? <Button onClick={() => { setQuery(''); setFilter('all'); setDay('all') }}>清除筛选</Button> : !isArxiv && <Button variant="primary" onClick={() => setImporting({})}><Plus size={16} />添加第一篇文献</Button>}
        </div>}
      {filtered.length > 0 && <p className="library-footnote">{filtered.length} 篇文献 · {isArxiv ? '原文已下载到本机 · 点击翻译后才生成译文' : '拖入 PDF 可继续添加'}{folder ? ' · 包含子文件夹' : ''}</p>}
    </div>
    {dragging && <div className="library-drop-overlay"><Upload size={40} /><h2>松开，添加到文献库</h2><p>接下来可选择文件夹和翻译方式</p></div>}
    {importing && <ImportDialog paths={importing.paths} onClose={() => setImporting(null)} />}
    {paper && <PaperDialog key={paper.id} paper={paper} onClose={() => setEditing(null)} />}
    {overviewPaper && <PaperOverviewDialog key={`${overviewPaper.id}:${overviewPaper.title}`} paper={overviewPaper} onClose={() => setOverviewId(null)} />}
    {settings && <TranslationSettings onClose={() => setSettings(false)} />}
    <PdfReader />
  </main>
}
