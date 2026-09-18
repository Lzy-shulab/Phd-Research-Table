import { useState } from 'react'
import { FileText, Languages, Upload } from 'lucide-react'
import { useLibrary } from '../../stores/library'
import { useWorkbench } from '../../stores/workbench'
import { Button } from '../ui/button'
import { Dialog } from '../ui/dialog'

export function ImportDialog({ paths, onClose }: { paths?: string[]; onClose: () => void }) {
  const library = useLibrary()
  const [folder, setFolder] = useState(['all', 'unfiled', 'arxiv'].includes(library.folderId) ? '' : library.folderId)
  const [translate, setTranslate] = useState(library.autoTranslate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const add = async () => {
    setBusy(true); setError('')
    try {
      const result = paths ? await window.workbench.importPapers(paths, folder || null, translate)
        : await window.workbench.pickPapers(folder || null, translate)
      if (!result.ok) { setError(result.error.message); return }
      const { added, duplicates, failures } = result.data
      await library.load()
      if (added || duplicates) useWorkbench.getState().notify([
        added ? `已添加 ${added} 篇文献${translate ? '，译文生成后会自动附入卡片' : ''}` : '',
        duplicates ? `${duplicates} 篇已在文献库中，保留原有位置` : ''
      ].filter(Boolean).join('；'), 'info')
      if (failures.length) setError(failures.join('\n'))
      else if (added || duplicates) onClose()
    } catch { setError('文件未能添加，请检查文件是否可读后重试。') }
    finally { setBusy(false) }
  }
  return <Dialog open title="添加文献" description="PDF 保存到本机，原文和中英对照版在同一张卡片中管理。" onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <div className="import-file-well"><FileText size={28} strokeWidth={1.3} /><strong>{paths ? `已选择 ${paths.length} 篇 PDF` : '选择一篇或多篇 PDF'}</strong>
      <span>{paths ? paths.map((path) => path.split(/[\\/]/).pop()).join('、') : '支持批量添加 · 每篇最大 100 MB'}</span></div>
    <label className="field">添加到文件夹<select aria-label="添加到文件夹" value={folder} onChange={(e) => setFolder(e.target.value)} disabled={busy}>
      <option value="">未分类</option>{library.folders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <label className="import-translation"><Languages size={22} /><span><strong>上传后自动翻译</strong><small>生成左右并排的英文原文与中文译文</small></span>
      <input type="checkbox" role="switch" aria-label="上传后自动翻译" checked={translate} disabled={busy} onChange={(e) => setTranslate(e.target.checked)} />
    </label>
    <p className="field-hint">沿用已安装的 PDF2zh：本机处理 PDF，文本通过引擎配置中的翻译服务联网翻译。翻译期间可继续安排计划和阅读其他文献。</p>
    {error && <p className="field-error import-error" role="alert">{error}</p>}
    <div className="dialog-actions"><Button onClick={onClose} disabled={busy}>取消</Button>
      <Button variant="primary" disabled={busy} onClick={() => void add()}><Upload size={16} />{busy ? '正在添加…' : paths ? '添加到文献库' : '选择 PDF 并添加'}</Button></div>
  </Dialog>
}
