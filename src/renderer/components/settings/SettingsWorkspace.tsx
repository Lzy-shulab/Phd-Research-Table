import { useEffect, useState } from 'react'
import { Check, Database, FolderOpen, HardDrive, Library, Rss, ScrollText } from 'lucide-react'
import type { PaperCollection, Result, StorageSnapshot } from '../../../shared/types'
import { Button } from '../ui/button'
import { useWorkbench } from '../../stores/workbench'
import { libraryAction, useLibrary } from '../../stores/library'
import { AppearanceSettings } from './AppearanceSettings'
import { AssistantSettings } from './AssistantSettings'
import { UpdateSettings } from './UpdateSettings'

const locations = [
  { kind: 'library', label: '文献 PDF', description: '保存手动导入的文献及对应译文。', icon: Library },
  { kind: 'publication', label: '科研成果 PDF', description: '保存已发表论文的 PDF 及对应译文。', icon: ScrollText },
  { kind: 'arxiv', label: 'Arxiv Daily', description: '自动下载的论文按日期整理，译文保存在原文旁。', icon: Rss }
] satisfies { kind: PaperCollection; label: string; description: string; icon: typeof Library }[]
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}
export function SettingsWorkspace() {
  const metadataOnline = useLibrary((state) => state.metadataOnline)
  const [snapshot, setSnapshot] = useState<StorageSnapshot | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const load = async () => {
    try { setSnapshot(unwrap(await window.workbench.storageSnapshot())); setError('') }
    catch (error) { setError(error instanceof Error ? error.message : '无法读取保存目录。') }
  }
  useEffect(() => { void load() }, [])
  const choose = async (kind: PaperCollection, label: string) => {
    setBusy(kind); setError(''); setSaved('')
    try {
      const next = unwrap(await window.workbench.chooseStorageDirectory(kind))
      if (next) { setSnapshot(next); setSaved(`${label}保存位置已更新，新文件将保存到此处。`) }
    } catch (error) { setError(error instanceof Error ? error.message : '保存位置未能更新，请重试。') }
    finally { setBusy(null) }
  }
  const reveal = async (kind: PaperCollection | 'database') => {
    setBusy(`open-${kind}`); setError(''); setSaved('')
    try { unwrap(await window.workbench.revealStorageDirectory(kind)) }
    catch (error) { setError(error instanceof Error ? error.message : '无法打开文件夹。') }
    finally { setBusy(null) }
  }
  const chooseDatabase = async () => {
    setBusy('database'); setError(''); setSaved('')
    try {
      if (!await useWorkbench.getState().flushAll()) throw new Error('请先保存尚未完成的任务修改。')
      const result = unwrap(await window.workbench.chooseDatabaseDirectory())
      if (result) {
        setSnapshot(result.snapshot)
        await useWorkbench.getState().bootstrap()
        await useLibrary.getState().load()
        setSaved(result.retainedSources.length ? '已切换到新数据文件夹。旧位置有文件未能清理，请检查旧目录。' : '工作台数据已迁移，新位置将在下次打开时继续使用。')
      }
    } catch (error) { setError(error instanceof Error ? error.message : '工作台数据迁移未完成。') }
    finally { setBusy(null) }
  }
  return <main className="settings-workspace">
    <header className="workspace-header"><div>
      <div className="workspace-breadcrumb">设置<span>/</span>外观、AI 与文件保存</div>
      <div className="heading-line"><h1>设置</h1></div>
      <p>让显示更舒适，让文件各有归处。</p>
    </div></header>
    <div className="settings-body">
      <AppearanceSettings />
      <AssistantSettings />
      <UpdateSettings />
      <section className="storage-section" id="storage-settings" aria-labelledby="storage-heading">
        <div className="storage-section-heading"><HardDrive size={19} /><div><h2 id="storage-heading">保存位置</h2><p>选择后自动保存，下次打开工作台继续使用。</p></div></div>
        <div className="storage-list">
          {locations.map(({ kind, label, description, icon: Icon }) => <div className="storage-row" key={kind} data-testid={`storage-${kind}`}>
            <div className="storage-row-heading"><span className="storage-icon"><Icon size={20} strokeWidth={1.6} /></span><div><h3>{label}</h3><p>{description}</p></div></div>
            <div className="storage-location"><p className="storage-path" aria-label={`${label}保存地址`}>{snapshot?.directories[kind] ?? '正在读取…'}</p>
              <div className="storage-actions"><Button disabled={!snapshot || !!busy} onClick={() => void reveal(kind)} aria-label={`打开${label}文件夹`}><FolderOpen size={15} />打开</Button>
                <Button disabled={!snapshot || !!busy} onClick={() => void choose(kind, label)} aria-label={`更改${label}保存位置`}>{busy === kind ? '正在检查…' : '更改位置'}</Button></div>
            </div>
          </div>)}
        </div>
        <p className="storage-note">更改位置仅影响之后新增的文件。已有文件保留在原位置，仍可阅读和导出；译文始终跟随对应原文。请保留仍在使用的旧文件夹。</p>
      </section>
      <div className="storage-feedback" aria-live="polite">
        {error ? <div className="field-error" role="alert">{error}{!snapshot && <Button onClick={() => void load()}>重试</Button>}</div>
          : saved && <p className="storage-saved"><Check size={16} />{saved}</p>}
      </div>
      <section className="storage-database" aria-labelledby="database-heading"><Database size={18} /><div><h2 id="database-heading">工作台数据</h2>
        <p>任务、笔记、分类及投稿记录保存在这里。更改时会校验并迁移现有数据，PDF 保存位置保持各自设置。</p><p className="storage-path">{snapshot?.databasePath ?? '正在读取…'}</p></div>
        <div className="storage-actions"><Button disabled={!snapshot || !!busy} onClick={() => void reveal('database')} aria-label="打开工作台数据文件夹"><FolderOpen size={15} />打开</Button>
          <Button disabled={!snapshot || !!busy} onClick={() => void chooseDatabase()} aria-label="更改工作台数据保存位置">{busy === 'database' ? '正在迁移…' : '更改位置'}</Button></div>
      </section>
      <section className="storage-metadata"><div><h2>文献信息自动读取</h2><p>导入后读取 PDF 标题、作者等资料，允许使用 DOI 或标题向 Crossref 查询公开书目；不会上传 PDF 全文。</p></div>
        <label><span>允许联网补全</span><input type="checkbox" role="switch" aria-label="允许联网补全文献信息" checked={metadataOnline} onChange={(event) => void libraryAction(window.workbench.setMetadataOnline(event.target.checked))} /></label></section>
    </div>
  </main>
}
