import { useEffect, useState } from 'react'
import { ChevronRight, Folder, FolderOpen, Library, MoreHorizontal, Plus, Rss } from 'lucide-react'
import { motion } from 'motion/react'
import type { LibraryFolder } from '../../../shared/types'
import { ARXIV_LIBRARY_FOLDER } from '../../../shared/arxiv'
import { PAPER_DAILY_FOLDER } from '../../../shared/paper-daily'
import { useLibrary } from '../../stores/library'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { FolderDialog } from './FolderDialog'
import { Disclosure } from '../ui/disclosure'

export function LibrarySidebar() {
  const { folders, papers, arxiv, paperDaily, journalFolderLabels, folderId, selectFolder, loaded } = useLibrary()
  const labelCandidates = JSON.stringify(folders.map(folder => [folder.id, folder.name, journalFolderLabels[folder.id]]))
  useEffect(() => {
    if (loaded) void window.workbench.refreshJournalAbbreviations()
  }, [loaded, labelCandidates])
  const [dialog, setDialog] = useState<{ folder?: LibraryFolder; parentId?: string | null } | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const descendants = (id: string): Set<string> => {
    const ids = new Set([id])
    for (let i = 0; i < folders.length; i++) for (const f of folders) if (f.parentId && ids.has(f.parentId)) ids.add(f.id)
    return ids
  }
  const row = (folder: LibraryFolder, depth = 0) => {
    const children = folders.filter((item) => item.parentId === folder.id)
    const selected = folderId === folder.id
    const ids = descendants(folder.id)
    return <div key={folder.id}>
      <div className={cn('folder-row', selected && 'selected')} style={{ paddingLeft: `${depth * 13 + 4}px` }}>
        <button className="folder-expand" aria-label={`${collapsed.has(folder.id) ? '展开' : '收起'} ${folder.name}`}
          aria-expanded={children.length ? !collapsed.has(folder.id) : undefined} aria-controls={children.length ? `folder-children-${folder.id}` : undefined}
          disabled={!children.length} onClick={() => setCollapsed((previous) => {
            const next = new Set(previous); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next
          })}>{children.length > 0 && <ChevronRight size={12} />}</button>
        <button className="folder-name" aria-current={selected ? 'page' : undefined} onClick={() => selectFolder(folder.id)} title={folder.name}>
          {selected ? <FolderOpen size={16} /> : <Folder size={16} />}<span>{journalFolderLabels[folder.id] || folder.name}</span>
          <small>{papers.filter((p) => p.folderId && ids.has(p.folderId)).length}</small>
        </button>
        {depth < 2 && <button className="folder-add-child" aria-label={`在 ${folder.name} 下新建子文件夹`} title="新建子文件夹" onClick={() => setDialog({ parentId: folder.id })}><Plus size={14} /></button>}
        <button className="folder-more" aria-label={`管理文件夹 ${folder.name}`} onClick={() => setDialog({ folder })}><MoreHorizontal size={15} /></button>
      </div>
      {!!children.length && <Disclosure id={`folder-children-${folder.id}`} open={!collapsed.has(folder.id)}>{children.map(child => row(child, depth + 1))}</Disclosure>}
    </div>
  }
  return <>
    <nav className="library-nav" aria-label="文献文件夹">
      {[{ id: 'all', name: '全部文献', icon: Library, count: papers.filter((p) => p.collection !== 'publication').length },
        { id: 'unfiled', name: '未分类', icon: Folder, count: papers.filter((p) => p.collection === 'library' && !p.folderId).length },
        { id: 'arxiv', name: 'Arxiv Daily', icon: Rss, count: arxiv.candidates.length },
        { id: PAPER_DAILY_FOLDER, name: 'Paper Daily', icon: Rss, count: paperDaily.entries.filter(paper => !paper.favorite).length }].map((item) =>
        <button key={item.id} aria-current={folderId === item.id ? 'page' : undefined} className={cn('sidebar-link', folderId === item.id && 'selected')} onClick={() => selectFolder(item.id)}>
          {folderId === item.id && <motion.span className="nav-selection" layoutId="library-selection" />}
          <item.icon size={17} /><span>{item.name}</span><small className="nav-count">{item.count}</small>
        </button>)}
    </nav>
    <div className="sidebar-section-label"><span>我的文件夹</span>
      <Button variant="ghost" className="icon-button small" aria-label="新建文献文件夹" onClick={() => setDialog({ parentId: null })}><Plus size={15} /></Button>
    </div>
    <div className="folder-tree">
      <div className={cn('folder-row', folderId === ARXIV_LIBRARY_FOLDER && 'selected')}>
        <span className="folder-expand" />
        <button className="folder-name" aria-current={folderId === ARXIV_LIBRARY_FOLDER ? 'page' : undefined} onClick={() => selectFolder(ARXIV_LIBRARY_FOLDER)} title="Arxiv Daily 收藏的文献">
          {folderId === ARXIV_LIBRARY_FOLDER ? <FolderOpen size={16} /> : <Folder size={16} />}<span>Arvix</span>
          <small>{papers.filter(paper => paper.collection === 'arxiv').length}</small>
        </button>
        <span className="folder-actions-placeholder" aria-hidden="true" />
      </div>
      {folders.filter((f) => !f.parentId).map((folder) => row(folder))}
    </div>
    <button className="new-project" onClick={() => setDialog({ parentId: null })}><Plus size={15} />新建文件夹</button>
    
    {dialog && <FolderDialog key={dialog.folder?.id ?? `new-${dialog.parentId ?? 'root'}`} folder={dialog.folder} parentId={dialog.parentId} onClose={() => setDialog(null)} />}
  </>
}
