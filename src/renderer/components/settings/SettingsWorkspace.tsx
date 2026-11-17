import { useEffect, useState } from 'react'
import { BookOpenCheck, Check, Database, FolderOpen, HardDrive, Languages, Library, Rss, ScrollText } from 'lucide-react'
import type { PaperCollection, Result, StorageSnapshot } from '../../../shared/types'
import { Button } from '../ui/button'
import { useWorkbench } from '../../stores/workbench'
import { libraryAction, useLibrary } from '../../stores/library'
import { AppearanceSettings } from './AppearanceSettings'
import { AssistantSettings } from './AssistantSettings'
import { UpdateSettings } from './UpdateSettings'
import { TranslationSettings } from '../literature/TranslationSettings'
import { SettingsHeading } from './SettingsHeading'
import { WidgetSettings } from './WidgetSettings'

const locations = [
  { kind: 'library', label: '文献 PDF', description: '手动导入的文献及对应译文。', icon: Library },
  { kind: 'publication', label: '科研成果 PDF', description: '已发表论文的 PDF 及对应译文。', icon: ScrollText },
  { kind: 'arxiv', label: 'Arvix 文献', description: '按日期保存收藏论文，译文位于原文旁。', icon: Rss }
] satisfies { kind: PaperCollection; label: string; description: string; icon: typeof Library }[]

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export function SettingsWorkspace() {
  const settingsTarget = useWorkbench((state) => state.settingsTarget)
  const metadataOnline = useLibrary((state) => state.metadataOnline)
  const [snapshot, setSnapshot] = useState<StorageSnapshot | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [translationSettings, setTranslationSettings] = useState(false)
  const load = async () => {
    try { setSnapshot(unwrap(await window.workbench.storageSnapshot())); setError('') }
    catch (failure) { setError(failure instanceof Error ? failure.message : '无法读取保存目录。') }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (settingsTarget !== 'assistant') return
    document.getElementById('assistant-settings')?.scrollIntoView({ block: 'start' })
    useWorkbench.getState().clearSettingsTarget()
  }, [settingsTarget])
  const choose = async (kind: PaperCollection, label: string) => {
    setBusy(kind); setError(''); setSaved('')
    try {
      const next = unwrap(await window.workbench.chooseStorageDirectory(kind))
      if (next) { setSnapshot(next); setSaved(`${label}保存位置已更新。`) }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存位置未能更新，请重试。') }
    finally { setBusy(null) }
  }
  const reveal = async (kind: PaperCollection | 'database') => {
    setBusy(`open-${kind}`); setError(''); setSaved('')
    try { unwrap(await window.workbench.revealStorageDirectory(kind)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '无法打开文件夹。') }
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
        setSaved(result.retainedSources.length ? '已切换数据文件夹；旧位置仍有文件，请检查旧目录。' : '工作台数据已迁移。')
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '工作台数据迁移未完成。') }
    finally { setBusy(null) }
  }
  return <main className="settings-workspace">
    <header className="workspace-header"><div>
      <div className="heading-line"><h1>设置</h1></div>
      <p className="settings-intro">调整工作台外观、桌面便签、AI 服务与本地数据。</p>
    </div></header>
    <div className="settings-body">
      <AppearanceSettings />
      <WidgetSettings />
      <AssistantSettings />
      <div className="settings-utility-grid">
        <section id="translation-settings-entry" className="storage-section translation-settings-entry settings-action-card"><SettingsHeading icon={Languages} title="全文翻译"><p>配置 PDF2zh 与全文翻译模型。</p></SettingsHeading><Button onClick={() => setTranslationSettings(true)}>打开翻译设置</Button></section>
        <UpdateSettings />
      </div>
      <section className="storage-section" id="storage-settings" aria-labelledby="storage-heading">
        <SettingsHeading icon={HardDrive} title="文件与数据" id="storage-heading"><p>新位置用于之后新增的文件；已有文件保留在原位置。</p></SettingsHeading>
        <div className="storage-list">
          {locations.map(({ kind, label, description, icon: Icon }) => <div className="storage-row" key={kind} data-testid={`storage-${kind}`}>
            <div className="storage-row-heading"><span className="storage-icon"><Icon size={20} strokeWidth={1.6} /></span><div><h3>{label}</h3><p>{description}</p></div></div>
            <div className="storage-location"><p className="storage-path" aria-label={`${label}保存地址`}>{snapshot?.directories[kind] ?? '正在读取…'}</p>
              <div className="storage-actions"><Button disabled={!snapshot || !!busy} onClick={() => void reveal(kind)} aria-label={`打开${label}文件夹`}><FolderOpen size={15} />打开</Button>
                <Button disabled={!snapshot || !!busy} onClick={() => void choose(kind, label)} aria-label={`更改${label}保存位置`}>{busy === kind ? '正在检查…' : '更改位置'}</Button></div>
            </div>
          </div>)}
          <div className="storage-row storage-database" data-testid="storage-database">
            <div className="storage-row-heading"><span className="storage-icon"><Database size={20} strokeWidth={1.6} /></span><div><h3>工作台数据</h3><p>更改位置时迁移任务、笔记与设置。</p></div></div>
            <div className="storage-location"><p className="storage-path">{snapshot?.databasePath ?? '正在读取…'}</p><div className="storage-actions"><Button disabled={!snapshot || !!busy} onClick={() => void reveal('database')} aria-label="打开工作台数据文件夹"><FolderOpen size={15} />打开</Button>
              <Button disabled={!snapshot || !!busy} onClick={() => void chooseDatabase()} aria-label="更改工作台数据保存位置">{busy === 'database' ? '正在迁移…' : '更改位置'}</Button></div></div>
          </div>
          <div className="storage-row storage-metadata">
            <div className="storage-row-heading"><span className="storage-icon"><BookOpenCheck size={20} strokeWidth={1.6} /></span><div><h3>文献信息自动读取</h3><p>使用 DOI 或标题查询 Crossref 公开书目。</p></div></div>
            <label className="settings-switch-row"><span>允许联网补全</span><span className="settings-switch"><input type="checkbox" role="switch" aria-label="允许联网补全文献信息" checked={metadataOnline} onChange={(event) => void libraryAction(window.workbench.setMetadataOnline(event.target.checked))} /><i aria-hidden="true" /></span></label>
          </div>
        </div>
        {(error || saved) && <div className="storage-feedback" aria-live="polite">
          {error ? <div className="field-error" role="alert">{error}{!snapshot && <Button onClick={() => void load()}>重试</Button>}</div>
            : <p className="storage-saved"><Check size={16} />{saved}</p>}
        </div>}
      </section>
      {translationSettings && <TranslationSettings onClose={() => setTranslationSettings(false)} />}
    </div>
  </main>
}
