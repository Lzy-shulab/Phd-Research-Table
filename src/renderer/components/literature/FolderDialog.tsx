import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { LibraryFolder } from '../../../shared/types'
import { libraryAction, useLibrary } from '../../stores/library'
import { Dialog, ConfirmDialog } from '../ui/dialog'
import { Button } from '../ui/button'

export function FolderDialog({ folder, parentId = null, onClose }: {
  folder?: LibraryFolder; parentId?: string | null; onClose: () => void
}) {
  const folders = useLibrary((s) => s.folders)
  const [name, setName] = useState(folder?.name ?? '')
  const [parent, setParent] = useState(folder?.parentId ?? parentId)
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState(false)
  const invalidParents = new Set(folder ? [folder.id] : [])
  for (let i = 0; i < folders.length; i++)
    for (const item of folders) if (item.parentId && invalidParents.has(item.parentId)) invalidParents.add(item.id)
  const depthOf = (id: string) => {
    let depth = 0
    let current: string | null = id
    const visited = new Set<string>()
    while (current && !visited.has(current)) {
      visited.add(current); depth++
      current = folders.find((item) => item.id === current)?.parentId ?? null
    }
    return depth
  }
  const subtreeHeight = folder ? Math.max(1, ...folders.filter((item) => invalidParents.has(item.id)).map((item) => depthOf(item.id) - depthOf(folder.id) + 1)) : 1
  const parentOptions = folders.filter((item) => !invalidParents.has(item.id) && depthOf(item.id) + subtreeHeight <= 3)
  const pathOf = (item: LibraryFolder) => {
    const names = [item.name]
    let current = item.parentId
    while (current) {
      const ancestor = folders.find((candidate) => candidate.id === current)
      if (!ancestor) break
      names.unshift(ancestor.name); current = ancestor.parentId
    }
    return names.join(' / ')
  }
  return <>
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}
      title={folder ? '管理文件夹' : parent ? '新建子文件夹' : '新建文献文件夹'} description="支持顶层、二级和三级文件夹，按期刊、会议或阅读主题整理文献。">
      <form className="project-form" onSubmit={async (event) => {
        event.preventDefault()
        if (busy || !name.trim()) return
        setBusy(true)
        const input = { name, parentId: parent }
        const result = await libraryAction(folder ? window.workbench.updateFolder(folder.id, input) : window.workbench.createFolder(input))
        setBusy(false)
        if (result) { useLibrary.getState().selectFolder(result.id); onClose() }
      }}>
        <label className="field">文件夹名称<input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：IEEE TGRS" /></label>
        <label className="field">上级文件夹<select aria-label="上级文件夹" value={parent ?? ''} onChange={(event) => setParent(event.target.value || null)}>
          <option value="">顶层文件夹</option>
          {parentOptions.map((item) => <option key={item.id} value={item.id}>{pathOf(item)}</option>)}
        </select></label>
        <p className="field-hint">当前最多三级；第三层文件夹不能再建立下级。</p>
        <div className="dialog-actions">
          {folder && <Button variant="ghost" className="danger-text push-right" disabled={busy} onClick={() => setRemove(true)}><Trash2 size={15} />删除文件夹</Button>}
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{busy ? '保存中…' : '保存文件夹'}</Button>
        </div>
      </form>
    </Dialog>
    <ConfirmDialog open={remove} busy={busy} title="删除此文件夹？" description="文献将保留在“未分类”，子文件夹移到顶层。原文与译文文件都会保留。"
      onClose={() => setRemove(false)} onConfirm={async () => {
        if (!folder) return
        setBusy(true)
        const result = await window.workbench.deleteFolder(folder.id)
        await libraryAction(Promise.resolve(result))
        setBusy(false)
        if (result.ok) onClose()
      }} />
  </>
}
