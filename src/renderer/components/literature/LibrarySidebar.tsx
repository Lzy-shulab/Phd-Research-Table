import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Library, MoreHorizontal, Plus, Rss } from 'lucide-react'
import { motion } from 'motion/react'
import type { LibraryFolder } from '../../../shared/types'
import { useLibrary } from '../../stores/library'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { FolderDialog } from './FolderDialog'

export function LibrarySidebar() {
  const { folders, papers, folderId, selectFolder } = useLibrary()
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
          disabled={!children.length} onClick={() => setCollapsed((previous) => {
            const next = new Set(previous); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next
          })}>{children.length > 0 && (collapsed.has(folder.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />)}</button>
        <button className="folder-name" aria-current={selected ? 'page' : undefined} onClick={() => selectFolder(folder.id)} title={folder.name}>
          {selected ? <FolderOpen size={16} /> : <Folder size={16} />}<span>{folder.name}</span>
          <small>{papers.filter((p) => p.folderId && ids.has(p.folderId)).length}</small>
        </button>
        {depth < 2 && <button className="folder-add-child" aria-label={`在 ${folder.name} 下新建子文件夹`} title="新建子文件夹" onClick={() => setDialog({ parentId: folder.id })}><Plus size={14} /></button>}
        <button className="folder-more" aria-label={`管理文件夹 ${folder.name}`} onClick={() => setDialog({ folder })}><MoreHorizontal size={15} /></button>
      </div>
      {!collapsed.has(folder.id) && children.map((child) => row(child, depth + 1))}
    </div>
  }
  return <>
    <nav className="library-nav" aria-label="文献文件夹">
      {[{ id: 'all', name: '全部文献', icon: Library, count: papers.filter((p) => p.collection === 'library').length },
        { id: 'unfiled', name: '未分类', icon: Folder, count: papers.filter((p) => p.collection === 'library' && !p.folderId).length },
        { id: 'arxiv', name: 'Arxiv Daily', icon: Rss, count: papers.filter((p) => p.collection === 'arxiv').length }].map((item) =>
        <button key={item.id} className={cn('sidebar-link', folderId === item.id && 'selected')} onClick={() => selectFolder(item.id)}>
          {folderId === item.id && <motion.span className="nav-selection" layoutId="library-selection" />}
          <item.icon size={17} /><span>{item.name}</span><small className="nav-count">{item.count}</small>
        </button>)}
    </nav>
    <div className="sidebar-section-label"><span>我的文件夹</span>
      <Button variant="ghost" className="icon-button small" aria-label="新建文献文件夹" onClick={() => setDialog({ parentId: null })}><Plus size={15} /></Button>
    </div>
    <div className="folder-tree">{folders.filter((f) => !f.parentId).map((folder) => row(folder))}</div>
    <button className="new-project" onClick={() => setDialog({ parentId: null })}><Plus size={15} />新建文件夹</button>
    {!folders.length && <p className="sidebar-note">为常读的期刊建一个文件夹，让文献各归其位。</p>}
    {dialog && <FolderDialog key={dialog.folder?.id ?? `new-${dialog.parentId ?? 'root'}`} folder={dialog.folder} parentId={dialog.parentId} onClose={() => setDialog(null)} />}
  </>
}
