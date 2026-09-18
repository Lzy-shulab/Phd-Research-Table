import { useEffect, useState } from 'react'
import { Bot, Check, PlugZap } from 'lucide-react'
import { assistantProviderLabels, assistantProviders, type AssistantProvider, type AssistantSettingsInput } from '../../../shared/assistant'
import { useAssistant } from '../../stores/assistant'
import { Button } from '../ui/button'

export function AssistantSettings() {
  const settings = useAssistant((state) => state.settings)
  const [provider, setProvider] = useState<AssistantProvider>('siliconflow')
  const [drafts, setDrafts] = useState<Partial<Record<AssistantProvider, AssistantSettingsInput>>>({})
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  useEffect(() => { void useAssistant.getState().load().then(() => setProvider(useAssistant.getState().settings?.activeProvider ?? 'siliconflow')) }, [])
  const saved = settings?.profiles.find((item) => item.provider === provider)
  const draft = drafts[provider] ?? { provider, model: saved?.model ?? '', baseUrl: saved?.baseUrl ?? '', apiKey: '', clearApiKey: false }
  const patch = (input: Partial<AssistantSettingsInput>) => { setDrafts((current) => ({ ...current, [provider]: { ...draft, ...input } })); setMessage(''); setError('') }
  const fixedProvider = provider === 'siliconflow'
  const fixedEndpoint = provider === 'siliconflow' || provider === 'openrouter'
  const providerNote = provider === 'siliconflow'
    ? '默认使用 SiliconFlow 的 Qwen/Qwen3-8B，API 地址已预置；只需填写自己的 SiliconFlow API Key。'
    : provider === 'openrouter'
      ? '默认自动选择免费模型，也可填写以 :free 结尾的模型 ID。免费模型仍需你自己的 OpenRouter API Key，额度由服务方决定。'
      : '支持兼容 Chat Completions 的模型服务。填写服务方提供的 API 基础地址（通常以 /v1 结尾）或完整接口地址。本机服务可不填密钥。'
  const save = async (test: boolean) => {
    setBusy(true); setMessage(''); setError('')
    try {
      const result = await window.workbench.saveAssistantSettings(draft)
      if (!result.ok) throw new Error(result.error.message)
      useAssistant.setState({ settings: result.data })
      setDrafts((current) => ({ ...current, [provider]: { ...draft, apiKey: '', clearApiKey: false } }))
      if (test) {
        const response = await window.workbench.testAssistant()
        if (!response.ok) throw new Error(`配置已保存。${response.error.message}`)
        setMessage(response.data)
      } else setMessage('配置已保存并启用。可以用 AI 助手添加计划了。')
    } catch (failure) { setError(failure instanceof Error ? failure.message : '配置未能保存。') }
    finally { setBusy(false) }
  }
  return <section id="assistant-settings" className="assistant-settings" aria-labelledby="assistant-settings-heading">
    <div className="storage-section-heading"><Bot size={20} /><div><h2 id="assistant-settings-heading">AI 助手</h2><p>说出计划，自动识别日期、时间和项目。</p></div></div>
    <div className="appearance-card assistant-config">
      <div className="appearance-segments" role="group" aria-label="AI 服务类型">
        {assistantProviders.map((value) => <button key={value} disabled={busy} aria-pressed={provider === value} onClick={() => { setProvider(value); setMessage(''); setError('') }}>{assistantProviderLabels[value]}</button>)}
      </div>
      <p className="assistant-note">{providerNote}</p>
      <label>API 地址<input aria-label="AI API 地址" value={draft.baseUrl} readOnly={fixedEndpoint} disabled={!saved || busy} placeholder="https://api.example.com/v1" onChange={(event) => patch({ baseUrl: event.target.value })} /></label>
      <label>模型<input aria-label="AI 模型" value={draft.model} readOnly={fixedProvider} disabled={!saved || busy} placeholder={provider === 'openrouter' ? 'openrouter/free' : '填写模型 ID'} onChange={(event) => patch({ model: event.target.value })} /></label>
      <label>API Key<input aria-label="AI API Key" type="password" autoComplete="off" spellCheck={false} value={draft.apiKey ?? ''} disabled={!saved || busy} placeholder={saved?.hasApiKey ? '已加密保存；留空继续使用' : '填写服务方提供的密钥'} onChange={(event) => patch({ apiKey: event.target.value, clearApiKey: false })} /></label>
      {saved?.hasApiKey && <label className="assistant-clear-key"><input type="checkbox" checked={!!draft.clearApiKey} disabled={busy} onChange={(event) => patch({ clearApiKey: event.target.checked, apiKey: '' })} />清除已保存的密钥</label>}
      <p className="assistant-note">只有提交计划时，输入内容、当前日期和项目名称才会发送给所选服务。连接测试只发送测试文字。密钥加密保存在本机。</p>
      <div className="assistant-config-actions"><Button variant="primary" disabled={!saved || busy} onClick={() => void save(false)}><Check size={15} />保存并启用</Button><Button disabled={!saved || busy} onClick={() => void save(true)}><PlugZap size={15} />{busy ? '处理中…' : '保存并测试连接'}</Button></div>
      <div role="status" className={error ? 'field-error' : 'assistant-note'}>{error || message || `当前启用：${settings ? assistantProviderLabels[settings.activeProvider] : 'SiliconFlow'}`}</div>
    </div>
  </section>
}
