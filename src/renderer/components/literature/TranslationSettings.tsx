import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Download, FolderOpen, KeyRound, Languages, PauseCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { TranslationHealth } from '../../../shared/types'
import {
  translationProfileRequiresKey,
  translationProviderLabels,
  type TranslationApiProfile,
  type TranslationProfileInput,
  type TranslationProfilesSnapshot
} from '../../../shared/translation'
import { libraryAction, useLibrary } from '../../stores/library'
import { Button } from '../ui/button'
import { Dialog } from '../ui/dialog'

const blankProfile = (): TranslationProfileInput => ({
  name: '自定义 API', provider: 'openai-compatible', model: '', baseUrl: '', apiKey: '', clearApiKey: false
})

function draftFrom(profile: TranslationApiProfile): TranslationProfileInput {
  return { id: profile.id, name: profile.name, provider: profile.provider, model: profile.model, baseUrl: profile.baseUrl, apiKey: '', clearApiKey: false }
}

export function TranslationSettings({ onClose }: { onClose: () => void }) {
  const auto = useLibrary((s) => s.autoTranslate)
  const [health, setHealth] = useState<TranslationHealth | null>(null)
  const [profiles, setProfiles] = useState<TranslationProfilesSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<TranslationProfileInput>(blankProfile())
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const select = (profile: TranslationApiProfile) => {
    setSelectedId(profile.id); setDraft(draftFrom(profile)); setDirty(false); setError('')
  }
  const check = async (preferredId?: string) => {
    setBusy(true)
    try {
      const [healthResult, profilesResult] = await Promise.all([
        window.workbench.translationHealth(), window.workbench.translationProfiles()
      ])
      if (!healthResult.ok) throw new Error(healthResult.error.message)
      if (!profilesResult.ok) throw new Error(profilesResult.error.message)
      setHealth(healthResult.data); setProfiles(profilesResult.data); setError('')
      const id = preferredId || selectedId || profilesResult.data.activeId
      const profile = profilesResult.data.profiles.find((item) => item.id === id) ?? profilesResult.data.profiles[0]
      if (profile) select(profile)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '暂时无法检查翻译服务。') }
    finally { setBusy(false) }
  }
  useEffect(() => { void check() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const update = <K extends keyof TranslationProfileInput>(key: K, value: TranslationProfileInput[K]) => {
    setDraft((current) => ({ ...current, [key]: value })); setDirty(true); setError('')
  }
  const save = async () => {
    setBusy(true); setError('')
    try {
      const result = await window.workbench.saveTranslationProfile(draft)
      if (!result.ok) throw new Error(result.error.message)
      setProfiles(result.data)
      const profile = draft.id ? result.data.profiles.find((item) => item.id === draft.id) : result.data.profiles.at(-1)
      if (profile) { setSelectedId(profile.id); setDraft(draftFrom(profile)); setDirty(false) }
      const healthResult = await window.workbench.translationHealth()
      if (healthResult.ok) setHealth(healthResult.data)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'API 配置未能保存。') }
    finally { setBusy(false) }
  }
  const activate = async () => {
    if (!draft.id || dirty) return
    setBusy(true); setError('')
    try {
      const result = await window.workbench.activateTranslationProfile(draft.id)
      if (!result.ok) throw new Error(result.error.message)
      setProfiles(result.data)
      const healthResult = await window.workbench.translationHealth()
      if (healthResult.ok) setHealth(healthResult.data)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '无法启用这项配置。') }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!draft.id) return
    setBusy(true); setError('')
    try {
      const result = await window.workbench.deleteTranslationProfile(draft.id)
      if (!result.ok) throw new Error(result.error.message)
      setProfiles(result.data)
      const next = result.data.profiles.find((item) => item.id === result.data.activeId) ?? result.data.profiles[0]
      if (next) select(next)
      const healthResult = await window.workbench.translationHealth()
      if (healthResult.ok) setHealth(healthResult.data)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '无法删除这项配置。') }
    finally { setBusy(false) }
  }
  const installEngine = async () => {
    setBusy(true); setError('')
    const poll = window.setInterval(async () => {
      const result = await window.workbench.translationHealth()
      if (result.ok) setHealth(result.data)
    }, 500)
    try {
      const result = await window.workbench.installTranslationEngine()
      if (!result.ok) throw new Error(result.error.message)
      setHealth(result.data)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '官方 PDF2zh 引擎未能安装。') }
    finally { window.clearInterval(poll); setBusy(false); await check(selectedId) }
  }

  const selected = profiles?.profiles.find((profile) => profile.id === selectedId)
  const builtIn = selected?.builtIn === true && draft.id === selected.id
  const requiresKey = translationProfileRequiresKey(draft.provider)
  const active = !!draft.id && profiles?.activeId === draft.id
  const fixedSiliconFlow = selected?.builtIn === true && draft.provider === 'siliconflow'
  const installing = !!health && ['downloading', 'verifying', 'extracting'].includes(health.installation.state)

  return <Dialog open title="文献翻译设置" description="选择一套 API 配置，或保存自己的 OpenAI 兼容接口。新设置从下一项翻译任务开始生效。" className="translation-settings-dialog" onOpenChange={(open) => { if (!open) onClose() }}>
    <div className="translation-health">
      {health?.installed && health.configured ? <CheckCircle2 size={22} className="health-ready" /> : <CircleAlert size={22} />}
      <div><strong>{busy && !health ? '正在检查翻译服务…' : health?.message ?? '尚未检查'}</strong><small>英文 → 简体中文 · 左右并排 · 保留 PDF 排版</small></div>
    </div>
    {installing && health && <div className="translation-engine-progress">
      <div role="progressbar" aria-label="PDF2zh 引擎安装进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={health.installation.progress ?? undefined}>
        <i style={{ width: `${health.installation.progress ?? 100}%` }} className={health.installation.progress === null ? 'indeterminate' : ''} />
      </div><small>{health.installation.message}</small>
    </div>}

    <div className="translation-profile-layout">
      <section className="translation-profile-list" aria-label="API 配置列表">
        <div className="translation-profile-heading"><strong>API 配置</strong><Button variant="ghost" className="icon-button small" aria-label="新增自定义 API 配置" onClick={() => { setSelectedId(''); setDraft(blankProfile()); setDirty(true); setError('') }}><Plus size={15} /></Button></div>
        {profiles?.profiles.map((profile) => <button type="button" key={profile.id} className={`translation-profile-option ${selectedId === profile.id ? 'selected' : ''}`} onClick={() => select(profile)}>
          <span><strong>{profile.name}</strong><small>{translationProviderLabels[profile.provider]}</small></span>
          <i className={profile.ready ? 'ready' : ''}>{profiles.activeId === profile.id ? '当前' : profile.ready ? '可用' : '待补全'}</i>
        </button>)}
      </section>

      <section className="translation-profile-editor">
        <div className="translation-editor-title"><div><strong>{draft.id ? '编辑配置' : '新增自定义配置'}</strong><small>{active ? '当前翻译使用此配置' : dirty && draft.id ? '有尚未保存的修改' : '密钥不会回显到页面'}</small></div>{active && <span>当前使用</span>}</div>
        <label className="field">配置名称<input value={draft.name} disabled={builtIn} maxLength={80} onChange={(event) => update('name', event.target.value)} /></label>
        <label className="field">接口类型<select value={draft.provider} disabled={builtIn} onChange={(event) => update('provider', event.target.value as TranslationProfileInput['provider'])}>
          {Object.entries(translationProviderLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {draft.provider !== 'siliconflowfree' && <label className="field">模型名称<input value={draft.model} readOnly={fixedSiliconFlow} maxLength={300} placeholder="例如 gemini-2.5-flash-lite" onChange={(event) => update('model', event.target.value)} /></label>}
        {draft.provider !== 'gemini' && draft.provider !== 'siliconflowfree' && <label className="field">API Base URL<input value={draft.baseUrl} readOnly={fixedSiliconFlow} maxLength={2000} spellCheck={false} placeholder="https://example.com/v1" onChange={(event) => update('baseUrl', event.target.value)} /><small>填写到 /v1，不要包含 /chat/completions。</small></label>}
        {requiresKey && <label className="field">API 密钥<div className="translation-secret-field"><KeyRound size={15} /><input type="password" autoComplete="new-password" value={draft.apiKey ?? ''} maxLength={10000} placeholder={selected?.hasApiKey && !draft.clearApiKey ? '已安全保存；留空则不修改' : '填写自己的 API 密钥'} onChange={(event) => { update('apiKey', event.target.value); update('clearApiKey', false) }} /></div>
          <small>{draft.clearApiKey ? '保存后将清除密钥。' : selected?.hasApiKey ? '已保存密钥；页面和接口均不会返回明文。' : profiles?.secureStorageAvailable === false ? '当前系统无法安全保存密钥。' : '密钥使用当前 Windows 账户的安全存储加密。'}</small></label>}
        {selected?.note && <p className="translation-profile-note">{selected.note}</p>}
        <div className="translation-editor-actions">
          {!builtIn && draft.id && <Button variant="ghost" className="danger-text" disabled={busy} onClick={() => void remove()}><Trash2 size={14} />删除配置</Button>}
          {requiresKey && selected?.hasApiKey && !draft.clearApiKey && <Button variant="ghost" disabled={busy} onClick={() => update('clearApiKey', true)}>清除密钥</Button>}
          <span />
          <Button disabled={busy || (!dirty && !!draft.id)} onClick={() => void save()}>{busy ? '正在保存…' : '保存配置'}</Button>
          <Button variant="primary" disabled={busy || !draft.id || dirty || active || !selected?.ready} onClick={() => void activate()}>{active ? '正在使用' : dirty ? '先保存修改' : '使用此配置'}</Button>
        </div>
      </section>
    </div>

    <label className="import-translation"><Languages size={22} /><span><strong>默认自动翻译新文献</strong><small>每次添加时仍可单独调整</small></span>
      <input type="checkbox" role="switch" aria-label="默认自动翻译新文献" checked={auto} onChange={(event) => void libraryAction(window.workbench.setAutoTranslate(event.target.checked))} /></label>
    <p className="field-hint">“免费”是当前服务政策或公益额度，不代表永久免费。排版在本机处理，文本会发送给所选服务商；关闭应用会暂停队列。</p>
    <div className="translation-directory"><span>翻译引擎文件夹</span><p>{health?.serverDirectory || '尚未选择'}</p>
      {!health?.installed && <small>首次使用可安装官方 Windows 资源包（下载约 592 MB，解压后约需 1.2 GB）；也可继续使用已有的 PDF2zh Next。</small>}</div>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="dialog-actions">{installing ? <Button variant="ghost" onClick={() => void window.workbench.cancelTranslationEngineInstall()}><PauseCircle size={15} />暂停安装</Button>
      : health && !health.installed && <Button variant="primary" disabled={busy} onClick={() => void installEngine()}><Download size={15} />{health.installation.state === 'error' ? '继续安装官方引擎' : '一键安装官方引擎'}</Button>}
      <Button disabled={busy} onClick={async () => { await libraryAction(window.workbench.chooseTranslationDirectory()); await check(selectedId) }}><FolderOpen size={15} />选择已有环境</Button>
      <Button disabled={busy} onClick={() => void check(selectedId)}><RefreshCw size={15} />重新检查</Button><Button variant="primary" onClick={onClose}>完成</Button></div>
  </Dialog>
}
