import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { BookOpen, BookOpenText, Check, FileText, FolderOpen, Languages, MoreHorizontal, Plus, RefreshCw, Search, Settings2, Upload, Download, LayoutGrid, List } from 'lucide-react'
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
import { useInterface } from '../../stores/interface'
import { ARXIV_LIBRARY_FOLDER } from '../../../shared/arxiv'
import './arxiv-discovery.css'

function PaperCard({ paper, folder, onEdit, onOverview, onTranslate }: { paper: Paper; folder?: string; onEdit: () => void; onOverview: () => void; onTranslate: () => void }) {
  const identifying = useMetadataJobs((state) => !!state.ids[paper.id])
  const live = useLibrary((state) => state.translationProgress?.paperId === paper.id ? state.translationProgress : null)
  const reduced = useReducedMotion()
  const read = paper.maxReadPage
  const progress = paper.readingStatus === 'done' ? 100 : Math.min(99, paper.readProgress)
  const translating = ['queued', 'translating'].includes(paper.translationStatus)
  const failed = ['failed', 'interrupted'].includes(paper.translationStatus)
  const open = () => useLibrary.getState().openPaper(paper.id, paper.translatedPath ? 'translated' : 'source')
  const translationLabel = paper.translationStatus === 'queued' ? '等待翻译' : paper.translationStatus === 'translating'
    ? `翻译中${live?.percent != null ? ` ${live.percent}%` : ''}` : failed ? '翻译重试' : '未翻译'
  return <motion.article className="paper-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} data-testid="paper-card">
    <div className="paper-cover-area">
      <button className="paper-cover-button" onClick={open} aria-label={`阅读 ${paper.title}`}><PdfCover paper={paper} /></button>
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
      {failed && <p className="paper-translation-error" title={paper.translationError}>{paper.translationError}</p>}
      <div className="paper-card-actions">
        <button className="paper-action-source" onClick={() => useLibrary.getState().openPaper(paper.id, 'source')}><FileText size={13} />原文</button>
        {paper.translatedPath ? <button className="bilingual-button" title="已翻译，打开全文中英对照译文" onClick={() => useLibrary.getState().openPaper(paper.id, 'translated')}><Languages size={13} />已翻译</button>
          : <button className="paper-action-translate" disabled={translating} title={translating ? '全文翻译处理中' : failed ? paper.translationError : '未翻译，点击生成全文中英对照译文'} onClick={onTranslate}>{translating ? <span className="tiny-spinner" /> : <Languages size={13} />}{translationLabel}</button>}
        <button className="paper-action-overview" onClick={onOverview}><BookOpenText size={13} />中英摘要</button>
      </div>
    </div>
    <div className="paper-progress-footer" title="上次位置与最远位置分开保存；读完状态由你确认。"><div><span>{paper.readingStatus === 'done' ? '已读完' : paper.readingStatus === 'reading' ? '阅读中' : '未读'}</span><strong>{progress}%</strong></div>
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
  const isArxivLibrary = library.folderId === ARXIV_LIBRARY_FOLDER
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [day, setDay] = useState('all')
  const [importing, setImporting] = useState<{ paths?: string[] } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [overviewId, setOverviewId] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const [retrieving, setRetrieving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [batchFolder, setBatchFolder] = useState('')
  const display = useInterface((state) => state.preferences.literatureDisplay)
  const setDisplay = useInterface((state) => state.update)
  const dragDepth = useRef(0)
  useEffect(() => {
    const openRecord = (event: Event) => setEditing((event as CustomEvent<string>).detail)
    window.addEventListener('workbench:open-literature-record', openRecord)
    return () => window.removeEventListener('workbench:open-literature-record', openRecord)
  }, [])
  const folder = library.folders.find((f) => f.id === library.folderId)
  const included = new Set([library.folderId])
  for (let i = 0; i < library.folders.length; i++) for (const f of library.folders) if (f.parentId && included.has(f.parentId)) included.add(f.id)
  const scoped = library.papers.filter((p) => isArxiv ? false : isArxivLibrary ? p.collection === 'arxiv'
    : p.collection !== 'publication' && (library.folderId === 'all' || (library.folderId === 'unfiled' ? p.collection === 'library' && !p.folderId : p.folderId && included.has(p.folderId))))
  const filtered = scoped.filter((paper) => {
    if (isArxivLibrary && day !== 'all' && paper.collectedDate !== day) return false
    if (!`${paper.title} ${paper.authors} ${paper.journal} ${paper.notes} ${paper.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())) return false
    if (filter === 'unread') return paper.readingStatus === 'unread'
    if (filter === 'reading') return paper.readingStatus === 'reading'
    if (filter === 'read') return paper.readingStatus === 'done'
    if (filter === 'translated') return paper.translationStatus === 'ready'
    if (filter === 'translating') return ['queued', 'translating'].includes(paper.translationStatus)
    if (filter === 'failed') return ['failed', 'interrupted'].includes(paper.translationStatus)
    return true
  }).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title)
    : sort === 'recent' ? (b.lastReadAt ?? '').localeCompare(a.lastReadAt ?? '') : b.addedAt.localeCompare(a.addedAt))
  const selectedCanMove = selected.size > 0 && [...selected].every(id => library.papers.find(paper => paper.id === id)?.collection === 'library')
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
  const retrieve = async () => {
    if (retrieving || library.arxiv.running) return
    setRetrieving(true)
    try { await libraryAction(window.workbench.runArxivDaily(), '检索已启动，进度显示在候选列表上方。') }
    finally { setRetrieving(false) }
  }
  return <main className="literature-workspace" onDragEnter={(event) => {
    if (isArxiv || isArxivLibrary || !event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current++; setDragging(true)
  }} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
    onDragLeave={(event) => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }} onDrop={(event) => {
      event.preventDefault(); dragDepth.current = 0; setDragging(false)
      if (isArxiv || isArxivLibrary) { useWorkbench.getState().notify('手动添加 PDF 请进入全部文献或其他文件夹。', 'info'); return }
      const files = Array.from(event.dataTransfer.files)
      const paths = files.filter((file) => /\.pdf$/i.test(file.name)).map((file) => window.workbench.droppedFilePath(file)).filter(Boolean)
      if (paths.length) setImporting({ paths })
      else useWorkbench.getState().notify('请拖入本机上的 PDF 文献文件。')
    }}>
    <header className="workspace-header library-header"><div><div className="workspace-breadcrumb">{isArxiv ? '文献检索' : '文献阅读'}<span>/</span>{isArxiv ? 'Arxiv Daily' : isArxivLibrary ? '我的文件夹 / Arvix' : folder?.name ?? (library.folderId === 'unfiled' ? '未分类' : '全部文献')}</div>
      <div className="heading-line"><h1>{isArxiv ? 'Arxiv Daily' : isArxivLibrary ? 'Arvix' : folder?.name ?? (library.folderId === 'unfiled' ? '未分类' : '文献库')}</h1><span className="library-count">{isArxiv ? `${library.arxiv.candidates.length} 篇待筛选` : `${scoped.length} 篇`}</span></div>
      <p>{isArxiv ? '先读中英标题与摘要，再收藏值得深入阅读的论文。' : isArxivLibrary ? '来自 Arxiv Daily 的收藏，点击文献即可开始阅读。' : '让每一次阅读，留下下一步研究的线索。'}</p></div>
      <div className="workspace-actions"><Button variant="ghost" className="icon-button" aria-label="文献翻译设置" onClick={() => setSettings(true)}><Settings2 size={18} /></Button>
        {isArxiv ? <Button variant="primary" aria-busy={retrieving || library.arxiv.running} disabled={retrieving || library.arxiv.running} onClick={() => void retrieve()}>{retrieving || library.arxiv.running ? <span className="tiny-spinner" /> : <Download size={16} />}{retrieving || library.arxiv.running ? '检索中…' : '立即检索'}</Button>
          : isArxivLibrary ? <Button onClick={() => library.selectFolder('arxiv')}><Search size={16} />检索新文献</Button> : <Button variant="primary" onClick={() => setImporting({})}><Plus size={17} />添加文献</Button>}</div>
    </header>
    {!isArxiv && <div className="library-toolbar"><label className="library-search"><Search size={17} /><input aria-label="搜索文献" placeholder="搜索标题、作者、期刊或笔记" value={query} onChange={(e) => setQuery(e.target.value)} />
      {query && <button aria-label="清除文献搜索" onClick={() => setQuery('')}>×</button>}</label>
      <select aria-label="文献状态筛选" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部状态</option><option value="unread">未读</option><option value="reading">阅读中</option><option value="read">已读完</option><option value="translated">已有中英对照</option><option value="translating">翻译中</option><option value="failed">翻译待重试</option></select>
      <select aria-label="文献排序" value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">最近添加</option><option value="recent">最近阅读</option><option value="title">标题排序</option></select>
      {isArxivLibrary && <select aria-label="收录日期" value={day} onChange={(e) => setDay(e.target.value)}><option value="all">全部收录日期</option>{[...new Set(scoped.map((p) => p.collectedDate))].sort().reverse().map((date) => <option key={date}>{date}</option>)}</select>}
      {!isArxiv && <div className="segmented-control view-switch" role="group" aria-label="文献显示方式"><button aria-pressed={display === 'cards'} onClick={() => void setDisplay({ literatureDisplay: 'cards' })}><LayoutGrid size={15} />卡片</button><button aria-pressed={display === 'list'} onClick={() => void setDisplay({ literatureDisplay: 'list' })}><List size={15} />列表</button></div>}
    </div>}
    {!isArxiv && display === 'list' && <div className="batch-toolbar"><label><input type="checkbox" checked={filtered.length > 0 && filtered.every((paper) => selected.has(paper.id))} onChange={(event) => setSelected(event.target.checked ? new Set(filtered.map((paper) => paper.id)) : new Set())} />选择当前结果</label><span>{selected.size} 篇已选</span><select aria-label="批量文献文件夹" disabled={!selectedCanMove} title={selectedCanMove ? undefined : 'Arvix 文献统一保留在 Arvix 文件夹；请选择普通文献调整文件夹。'} value={batchFolder} onChange={(event) => setBatchFolder(event.target.value)}><option value="">移动到文件夹…</option><option value="unfiled">未分类</option>{library.folders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button disabled={!selectedCanMove || !batchFolder} onClick={async () => { for (const id of selected) { const result = await window.workbench.updatePaper(id, { folderId: batchFolder === 'unfiled' ? null : batchFolder }); if (!result.ok) { useWorkbench.getState().notify(result.error.message); return } } await library.load(); setSelected(new Set()) }}>批量移动</Button><select aria-label="批量阅读状态" defaultValue="" onChange={async (event) => { if (!event.target.value) return; for (const id of selected) { const result = await window.workbench.updatePaper(id, { readingStatus: event.target.value as Paper['readingStatus'] }); if (!result.ok) { useWorkbench.getState().notify(result.error.message); return } } await library.load(); setSelected(new Set()); event.target.value = '' }}><option value="">设置阅读状态…</option><option value="unread">未读</option><option value="reading">阅读中</option><option value="done">已读完</option></select></div>}
    <TranslationQueue papers={scoped} />
    <div className="library-scroll">
      {isArxiv && <ArxivDailyPanel retrieving={retrieving} />}
      {library.loadError ? <div className="empty-state"><p role="alert">{library.loadError}</p><Button onClick={() => void library.load()}><RefreshCw size={15} />重试</Button></div>
        : !library.loaded ? <div className="empty-state">正在读取文献库…</div>
        : isArxiv ? null : filtered.length ? display === 'list' && !isArxiv ? <div className="paper-compact-list" aria-label="文献紧凑列表">{filtered.map((item) => <article key={item.id} className="paper-compact-row"><input aria-label={`选择 ${item.title}`} type="checkbox" checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next })} /><button className="paper-compact-title" title={item.title} onClick={() => useLibrary.getState().openPaper(item.id)}><strong>{item.title}</strong><span>{item.authors || '作者待补充'}</span></button><span className="paper-list-year">{item.year || '—'}</span><span className="paper-list-journal" title={item.journal}>{item.journal || '—'}</span><span className={`reading-status status-${item.readingStatus}`}>{item.readingStatus === 'done' ? '已读完' : item.readingStatus === 'reading' ? '阅读中' : '未读'}</span><div className="paper-list-actions"><Button onClick={() => useLibrary.getState().openPaper(item.id)}><BookOpen size={14} />阅读</Button><Button className="button-translation" disabled={['queued', 'translating'].includes(item.translationStatus)} onClick={() => item.translatedPath ? useLibrary.getState().openPaper(item.id, 'translated') : void translate(item)}><Languages size={14} />{item.translatedPath ? '译文' : item.translationStatus === 'queued' ? '排队中' : item.translationStatus === 'translating' ? '翻译中' : ['failed', 'interrupted'].includes(item.translationStatus) ? '重试' : '翻译'}</Button><Button variant="ghost" onClick={() => setEditing(item.id)}>编辑</Button></div></article>)}</div>
          : <div className="paper-grid">{filtered.map((item) => <PaperCard key={item.id} paper={item} folder={library.folders.find((f) => f.id === item.folderId)?.name} onEdit={() => setEditing(item.id)} onOverview={() => setOverviewId(item.id)} onTranslate={() => void translate(item)} />)}</div>
        : <div className="library-empty"><div className="empty-paper-stack"><FileText size={46} strokeWidth={1} /></div>
          <h2>{scoped.length ? '没有找到符合条件的文献' : isArxivLibrary ? '收藏的 arXiv 文献会收录在这里' : '从一篇值得读的文献开始'}</h2>
          <p>{scoped.length ? '调整搜索或筛选，继续寻找研究线索。' : isArxivLibrary ? '前往 Arxiv Daily，阅读中英摘要后收藏。' : '拖入 PDF，或添加文献。按期刊整理，随时阅读中英对照。'}</p>
          {scoped.length ? <Button onClick={() => { setQuery(''); setFilter('all'); setDay('all') }}>清除筛选</Button> : isArxivLibrary ? <Button onClick={() => library.selectFolder('arxiv')}><Search size={16} />前往检索</Button> : <Button variant="primary" onClick={() => setImporting({})}><Plus size={16} />添加第一篇文献</Button>}
        </div>}
      {filtered.length > 0 && <p className="library-footnote">{filtered.length} 篇文献 · {isArxivLibrary ? '原文已下载到本机 · 可按需生成全文译文' : '拖入 PDF 可继续添加'}{folder ? ' · 包含子文件夹' : ''}</p>}
    </div>
    {dragging && <div className="library-drop-overlay"><Upload size={40} /><h2>松开，添加到文献库</h2><p>接下来可选择文件夹和翻译方式</p></div>}
    {importing && <ImportDialog paths={importing.paths} onClose={() => setImporting(null)} />}
    {paper && <PaperDialog key={paper.id} paper={paper} onClose={() => setEditing(null)} />}
    {overviewPaper && <PaperOverviewDialog key={`${overviewPaper.id}:${overviewPaper.title}`} paper={overviewPaper} onClose={() => setOverviewId(null)} />}
    {settings && <TranslationSettings onClose={() => setSettings(false)} />}
    <PdfReader />
  </main>
}
