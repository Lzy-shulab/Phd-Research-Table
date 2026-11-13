import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { BookOpenText, FilePdf, Folder, FolderOpen, UploadSimple, ArrowClockwise, CaretRight, CaretDown, MagnifyingGlass, X, Play } from '@phosphor-icons/react'
import type { ImportReport, Paper, TranslationProgress } from '../../shared/types'
import type { DesktopLibrarySnapshot } from '../../shared/widget'
import { ARXIV_LIBRARY_FOLDER } from '../../shared/arxiv'
import { PanelFrame } from './PanelFrame'
import { PanelFooter } from './PanelFooter'
import { DesktopDisclosure } from './DesktopDisclosure'
import { desktopPaperMatches } from '../../domain/desktop-reading'
import { unwrap } from './api'
import './reading.css'

const labels = { idle: '未翻译', queued: '等待翻译', translating: '正在翻译', ready: '译文就绪', failed: '翻译失败', interrupted: '翻译已中断' }
export function ReadingPanel() {
  const [data, setData] = useState<DesktopLibrarySnapshot | null>(null)
  const [folder, setFolder] = useState(() => sessionStorage.getItem('desktop-reading-folder') ?? 'all'), [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const [importHint, setImportHint] = useState('')
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [query, setQuery] = useState(() => sessionStorage.getItem('desktop-reading-query') ?? '')
  const [updatedAt, setUpdatedAt] = useState<number | null>(null), [refreshing, setRefreshing] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [translationRequest, setTranslationRequest] = useState<Paper | null>(null)
  const [translationError, setTranslationError] = useState<{ id: string; message: string } | null>(null)
  const [resuming, setResuming] = useState(false)
  const snapshotRequest = useRef(0)
  const latestProgress = useRef<{ translationProgress: TranslationProgress | null; activeTranslationProgress: TranslationProgress[] } | null>(null)
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : '操作未完成，请重试。')
  const reload = useCallback(async () => {
    const request = ++snapshotRequest.current
    const seen = latestProgress.current
    setRefreshing(true)
    try {
      const snapshot = unwrap(await window.workbench.desktopLibrary())
      if (request !== snapshotRequest.current) return
      const latest = latestProgress.current
      setData(latest && latest !== seen ? { ...snapshot, ...latest } : snapshot)
      setUpdatedAt(Date.now())
    } finally { if (request === snapshotRequest.current) setRefreshing(false) }
  }, [])
  useEffect(() => {
    const off = window.workbench.onLibraryChanged(() => { void reload().catch(fail) })
    const progress = window.workbench.onTranslationProgress((translationProgress, activeTranslationProgress) => {
      const next = { translationProgress, activeTranslationProgress }
      latestProgress.current = next
      setData(current => current ? { ...current, ...next } : current)
    })
    void reload().catch(fail)
    return () => { off(); progress() }
  }, [reload])
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 5000); return () => clearTimeout(timer) }, [message])
  const targetFolder = data?.folders.some(f => f.id === folder) ? folder : null
  const imported = async (action: () => Promise<ImportReport & { translationMessage: string }>) => {
    setBusy(true); setError(''); setMessage('')
    try {
      const report = await action()
      setImportHint(report.translationMessage)
      setMessage([report.added ? `已保存 ${report.added} 篇` : '', report.duplicates ? `${report.duplicates} 篇已在文献库` : '', report.translationMessage ? '翻译未就绪' : ''].filter(Boolean).join(' · '))
      if (report.failures.length) setError(report.failures.join('；'))
      await reload()
    } catch(e) { fail(e) } finally { setBusy(false) }
  }
  const drop = (event: DragEvent) => {
    event.preventDefault(); setDragging(false)
    if (busy) return
    const files = [...event.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.pdf'))
    const paths = files.map(file => window.workbench.droppedFilePath(file)).filter(Boolean)
    if (!paths.length) { setError('请从文件夹拖入 PDF 文件。'); return }
    void imported(async () => unwrap(await window.workbench.importDesktopPapers(paths, targetFolder)))
  }
  const all = data?.papers.filter(p => p.collection !== 'publication') ?? []
  const inFolder = (paper: Paper, id: string) => id === 'all' || id === ARXIV_LIBRARY_FOLDER && paper.collection === 'arxiv' || id === 'unfiled' && !paper.folderId && paper.collection === 'library' || paper.folderId === id
  const activeFolder = ['all', 'unfiled', ARXIV_LIBRARY_FOLDER].includes(folder) || data?.folders.some(item => item.id === folder) ? folder : 'all'
  const papers = all.filter(p => inFolder(p, activeFolder) && desktopPaperMatches(p, query))
  const resume = data?.resume
  const resumePaper = resume ? all.find(paper => paper.id === resume.paperId) : undefined
  const progress = data?.translationProgress
  const queued = data?.papers.filter(p => p.translationStatus === 'queued' && p.id !== progress?.paperId) ?? []
  const currentPaper = data?.papers.find(p => p.id === progress?.paperId)
  const paused = Boolean(data?.translationPaused && queued.length)
  const queueError = !paused && queued.length ? data?.translationQueueError : ''
  const progressPaper = progress ? currentPaper : translationRequest ?? (queued.length === 1 ? queued[0] : undefined)
  const stage = progress?.stage ?? (translationRequest ? '正在检查翻译配置' : paused ? '翻译队列已暂停' : queueError ? '翻译队列等待配置' : '等待翻译')
  const percent = progress?.percent ?? null
  const startTranslation = async (paper: Paper) => {
    if (translationRequest) return
    setTranslationRequest(paper); setTranslationError(null); setError('')
    try {
      unwrap(await window.workbench.retryTranslation(paper.id))
      await reload().catch(fail)
    } catch (error) {
      setTranslationError({ id: paper.id, message: error instanceof Error ? error.message : '未能开始翻译，请重试。' })
    } finally { setTranslationRequest(null) }
  }
  const resumeTranslation = async () => {
    setResuming(true); setError('')
    try {
      unwrap(await window.workbench.setTranslationPaused(false))
      await reload()
    } catch (error) { fail(error) }
    finally { setResuming(false) }
  }
  const open = async (paper: Paper, translated: boolean) => {
    if (opening) return
    setOpening(paper.id); setError('')
    try { unwrap(await window.workbench.openDesktopPaper(paper.id, translated ? 'translated' : 'source')) } catch(e) { fail(e) } finally { setOpening(null) }
  }
  const folderItems = [{ id: 'all', name: '全部论文', depth: 0 }, { id: 'unfiled', name: '未分组', depth: 0 }, { id: ARXIV_LIBRARY_FOLDER, name: 'Arxiv', depth: 0 }]
  const visit = (parent: string | null, depth: number) => {
    for (const item of data?.folders.filter(f => f.parentId === parent && f.id !== ARXIV_LIBRARY_FOLDER) ?? []) { folderItems.push({ id: item.id, name: item.name, depth }); if (!collapsed.has(item.id)) visit(item.id, depth + 1) }
  }
  visit(null, 0)
  const folderName = folderItems.find(f => f.id === activeFolder)?.name ?? data?.folders.find(f => f.id === activeFolder)?.name ?? '全部论文'
  const toggleFolder = (id: string) => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  return <PanelFrame title="论文阅读" busy={busy || Boolean(opening || translationRequest) || resuming} footer={<PanelFooter updatedAt={updatedAt} status={message ? <span title={importHint}>{message}</span> : busy ? '保存中' : error ? '操作未完成' : undefined} onRefresh={() => { void reload().then(() => setError('')).catch(fail) }} busy={busy || refreshing} refreshLabel="刷新文献"/> }>
    <section className={`reading-stack ${dragging ? 'is-dragging' : ''}`} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragging(true) }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }} onDrop={drop} aria-label="PDF 拖入区域">
    <div className="reading-toolbar"><button className="reading-directory-toggle" aria-label={directoryOpen ? '收起目录' : '展开目录'} aria-expanded={directoryOpen} aria-controls="desktop-reading-directory" onClick={() => setDirectoryOpen(!directoryOpen)}><FolderOpen size={24} weight="duotone"/><span>目录</span><CaretDown size={20} className={directoryOpen ? '' : 'is-closed'}/></button>
      <button className="reading-import" aria-label="选择 PDF 文件" disabled={busy} onClick={() => { void imported(async () => unwrap(await window.workbench.pickDesktopPapers(targetFolder))) }}><UploadSimple size={24}/><span>{busy ? '保存中' : '导入 PDF'}</span></button></div>
    <label className="reading-search"><MagnifyingGlass size={24}/><input aria-label="搜索论文" placeholder="搜索标题、作者、标签" value={query} maxLength={500} onChange={event => { setQuery(event.target.value); sessionStorage.setItem('desktop-reading-query', event.target.value) }}/>{query && <button aria-label="清空论文搜索" onClick={() => { setQuery(''); sessionStorage.removeItem('desktop-reading-query') }}><X size={20}/></button>}</label>
    {(translationRequest || progress || queued.length > 0) && <section className="reading-translation" aria-label="翻译队列">
      <div className="reading-translation-top">
        <strong role="status">{stage}</strong>
        {percent !== null && <span>{Math.round(percent)}%</span>}
        {!progress && paused && <button type="button" disabled={resuming} onClick={() => { void resumeTranslation() }}>{resuming ? '正在继续…' : '继续队列'}</button>}
      </div>
      <div className="reading-translation-track" role="progressbar" aria-label="论文翻译进度" aria-valuenow={percent === null ? undefined : Math.round(percent)} aria-valuetext={percent === null ? stage : undefined}
        data-indeterminate={percent === null && Boolean(translationRequest || progress)}>
        <span style={percent === null ? undefined : { width: `${percent}%` }}/>
      </div>
      {progressPaper && <span className="reading-translation-paper" title={progressPaper.title}>{progressPaper.title}</span>}
      {(progress?.current != null && progress.total != null || queued.length > 0 || (data?.activeTranslationProgress.length ?? 0) > 1) && <div className="reading-translation-detail">
        {progress?.current != null && progress.total != null && <span>阶段进度 {progress.current} / {progress.total}</span>}
        {queued.length > 0 && <span>{queued.length} 篇等待{paused && progress ? '（队列已暂停）' : ''}</span>}
        {(data?.activeTranslationProgress.length ?? 0) > 1 && <span>{data?.activeTranslationProgress.length} 篇正在翻译</span>}
      </div>}
      {!progress && queueError && <p className="reading-paper-error" role="alert">{queueError}</p>}
    </section>}
    <div className="reading-scroll">
    <DesktopDisclosure id="desktop-reading-directory" open={directoryOpen}>{() => <nav className="reading-directory" aria-label="论文文件夹">{folderItems.map(item => {
      const children = data?.folders.some(f => f.parentId === item.id)
      return <div className={`reading-folder-row${activeFolder === item.id ? ' is-current' : ''}`} key={item.id} style={{ marginLeft: item.depth * 16 }}>
        <button className="reading-folder-select" aria-label={item.name} aria-current={activeFolder === item.id ? 'page' : undefined} onClick={() => { setFolder(item.id); sessionStorage.setItem('desktop-reading-folder', item.id) }}>{activeFolder === item.id ? <FolderOpen size={24} weight="duotone"/> : <Folder size={24}/>}<span>{item.name}</span><small>{all.filter(p => inFolder(p, item.id)).length}</small></button>
        {children && <button className="reading-folder-fold" aria-label={`${collapsed.has(item.id) ? '展开' : '折叠'} ${item.name}`} aria-expanded={!collapsed.has(item.id)} onClick={() => toggleFolder(item.id)}>{collapsed.has(item.id) ? <CaretRight size={20}/> : <CaretDown size={20}/>}</button>}
      </div>
    })}</nav>}</DesktopDisclosure>
    {error && <p className="desktop-error" role="alert">{error}<button onClick={() => { void window.workbench.openWorkbench() }}>打开工作台</button></p>}
    {!query.trim() && resumePaper && resume && <button className="reading-resume" aria-label="继续上次阅读" disabled={Boolean(opening)} onClick={() => { void open(resumePaper, resume.variant === 'translated') }}><Play size={28} weight="duotone"/><span><strong>继续阅读</strong><span className="reading-resume-title">{resumePaper.title}</span><small>{resume.variant === 'translated' ? '中英对照' : '原文'} · 第 {resume.page} 页</small></span><CaretRight size={20}/></button>}
      <div className="reading-list-heading"><h2>{folderName}</h2><span>{papers.length} 篇</span></div>
      <section className="reading-papers" aria-label="论文列表">
        {!data ? <span className="desktop-spinner" role="status" aria-label="加载文献库"/> : !papers.length ? <div className="reading-empty"><BookOpenText size={40} weight="duotone"/><p>{query.trim() ? '没有匹配的论文' : '暂无论文'}</p></div> : papers.map(paper => {
          const active = data?.activeTranslationProgress.find(progress => progress.paperId === paper.id)
          const status = active ? 'translating' : paper.translationStatus
          const checking = translationRequest?.id === paper.id && !active && status !== 'queued'
          const requestError = translationError?.id === paper.id && ['idle', 'failed', 'interrupted'].includes(status) ? translationError.message : ''
          return <article className={`reading-paper${opening === paper.id ? ' is-opening' : ''}`} key={paper.id} aria-busy={opening === paper.id}>
          <button className="reading-paper-title" onClick={() => { void open(paper, paper.translationStatus === 'ready') }}><FilePdf size={22} weight="duotone"/><span>{paper.title}</span></button>
          <div className="reading-paper-meta"><span className={`translation-${status}`}>{active ? active.stage : checking ? '正在检查翻译配置' : status === 'queued' && paused ? '等待翻译 · 队列已暂停' : labels[status]}</span>{active?.percent != null && <span>{Math.round(active.percent)}%</span>}</div>
          {!checking && !active && (requestError || paper.translationError) && <p className="reading-paper-error" role={requestError || status === 'failed' ? 'alert' : undefined}>{requestError || paper.translationError}</p>}
          <div className="reading-paper-actions"><button onClick={() => { void open(paper, false) }}>原文 <CaretRight size={14}/></button>{status === 'ready' ? <button onClick={() => { void open(paper, true) }}>中英对照 <CaretRight size={14}/></button> : ['idle','failed','interrupted'].includes(status) && <button disabled={Boolean(translationRequest)} onClick={() => { void startTranslation(paper) }}><ArrowClockwise size={14}/>{checking ? '检查中…' : status === 'idle' ? '翻译' : '重试'}</button>}</div>
        </article>})}
      </section>
    </div>
      {dragging && <div className="reading-drop-hint"><UploadSimple size={40}/><strong>松开导入</strong></div>}
    </section>
  </PanelFrame>
}
