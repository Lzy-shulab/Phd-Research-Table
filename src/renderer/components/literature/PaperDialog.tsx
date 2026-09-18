import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Paper } from '../../../shared/types'
import { libraryAction, useLibrary } from '../../stores/library'
import { Button } from '../ui/button'
import { ConfirmDialog, Dialog } from '../ui/dialog'

export function PaperDialog({ paper, onClose }: { paper: Paper; onClose: () => void }) {
  const folders = useLibrary((s) => s.folders)
  const [draft, setDraft] = useState({ title: paper.title, authors: paper.authors, journal: paper.journal,
    year: paper.year, folderId: paper.folderId, notes: paper.notes })
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState(false)
  return <>
    <Dialog open title="文献信息" description="补充文献信息、调整文件夹，或记录阅读笔记。" onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <form className="project-form" onSubmit={async (event) => {
        event.preventDefault(); if (busy || !draft.title.trim()) return; setBusy(true)
        const result = await libraryAction(window.workbench.updatePaper(paper.id, draft))
        setBusy(false); if (result) onClose()
      }}>
        <label className="field">文献标题<textarea value={draft.title} rows={2} maxLength={1000} required onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className="field">作者<input value={draft.authors} maxLength={2000} placeholder="填写作者" onChange={(e) => setDraft({ ...draft, authors: e.target.value })} /></label>
        <div className="field-pair"><label className="field">期刊 / 会议<input value={draft.journal} maxLength={500} placeholder="例如：IEEE TGRS" onChange={(e) => setDraft({ ...draft, journal: e.target.value })} /></label>
          <label className="field year-field">年份<input value={draft.year} maxLength={10} placeholder="2026" onChange={(e) => setDraft({ ...draft, year: e.target.value })} /></label></div>
        {paper.collection === 'library' && <label className="field">文献文件夹<select aria-label="文献文件夹" value={draft.folderId ?? ''} onChange={(e) => setDraft({ ...draft, folderId: e.target.value || null })}>
          <option value="">未分类</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select></label>}
        {paper.arxivId && <div className="paper-source-info"><strong>arXiv:{paper.arxivId}</strong><span>发布于 {paper.publishedDate} · 收录于 {paper.collectedDate}</span><p>{paper.abstract}</p></div>}
        <label className="field">阅读笔记<textarea rows={3} maxLength={50000} value={draft.notes} placeholder="问题、方法与值得进一步研究的线索…" onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
        <div className="dialog-actions">
          <Button variant="ghost" className="danger-text push-right" disabled={busy || paper.translationStatus === 'translating'} onClick={() => setRemove(true)}><Trash2 size={15} />移除文献</Button>
          <Button onClick={onClose} disabled={busy}>取消</Button><Button type="submit" variant="primary" disabled={busy || !draft.title.trim()}>{busy ? '保存中…' : '保存信息'}</Button>
        </div>
      </form>
    </Dialog>
    <ConfirmDialog open={remove} busy={busy} title="移除此文献？" description="文献库中的原文与译文副本将移到回收站，上传前的原始文件保留。文献信息与阅读笔记将从文献库移除。"
      onClose={() => setRemove(false)} onConfirm={async () => {
        setBusy(true); const result = await window.workbench.deletePaper(paper.id); await libraryAction(Promise.resolve(result)); setBusy(false); if (result.ok) onClose()
      }} />
  </>
}
