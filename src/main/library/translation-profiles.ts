import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import { DomainError } from '../../domain/errors'
import {
  defaultTranslationActiveId,
  defaultTranslationProfiles,
  translationProfileRequiresKey,
  type TranslationApiProfile,
  type TranslationProfileInput,
  type TranslationProfilesSnapshot,
  type TranslationProvider,
  type TranslationRuntimeProfile
} from '../../shared/translation'
import type { LibraryRepository } from '../database/repositories/library'

const SETTINGS_KEY = 'translation.profiles.v1'

interface StoredProfile {
  id: string
  name: string
  provider: TranslationProvider
  model: string
  baseUrl: string
  builtIn: boolean
  note: string
  encryptedApiKey: string
}

interface StoredState {
  version: 1
  activeId: string
  profiles: StoredProfile[]
}

export interface SecretProtector {
  available: () => boolean
  encrypt: (value: string) => string
  decrypt: (value: string) => string
}

export const electronSecretProtector: SecretProtector = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64'))
}

const defaults = (): StoredProfile[] => defaultTranslationProfiles.map((profile) => ({
  ...profile,
  encryptedApiKey: ''
}))

function isProvider(value: unknown): value is TranslationProvider {
  return ['siliconflowfree', 'gemini', 'siliconflow', 'openai-compatible'].includes(String(value))
}

function cleanStoredProfile(value: unknown): StoredProfile | null {
  if (!value || typeof value !== 'object') return null
  const profile = value as Partial<StoredProfile>
  if (typeof profile.id !== 'string' || !profile.id || typeof profile.name !== 'string' || !profile.name || !isProvider(profile.provider)) return null
  return {
    id: profile.id.slice(0, 100),
    name: profile.name.slice(0, 80),
    provider: profile.provider,
    model: typeof profile.model === 'string' ? profile.model.slice(0, 300) : '',
    baseUrl: typeof profile.baseUrl === 'string' ? profile.baseUrl.slice(0, 2000) : '',
    builtIn: profile.builtIn === true,
    note: typeof profile.note === 'string' ? profile.note.slice(0, 500) : '',
    encryptedApiKey: typeof profile.encryptedApiKey === 'string' ? profile.encryptedApiKey : ''
  }
}

function profileReady(profile: StoredProfile) {
  if (profile.provider === 'siliconflowfree') return true
  if (!profile.model || !profile.encryptedApiKey) return false
  return profile.provider === 'gemini' || !!profile.baseUrl
}

function publicProfile(profile: StoredProfile): TranslationApiProfile {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    model: profile.model,
    baseUrl: profile.baseUrl,
    builtIn: profile.builtIn,
    hasApiKey: !!profile.encryptedApiKey,
    ready: profileReady(profile),
    note: profile.note
  }
}

function cleanBaseUrl(value: string) {
  const url = value.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(url))
    throw new DomainError('VALIDATION', 'Base URL 请填写到 /v1，不要包含 /chat/completions。')
  let parsed: URL
  try { parsed = new URL(url) }
  catch { throw new DomainError('VALIDATION', '请输入有效的 API Base URL。') }
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local))
    throw new DomainError('VALIDATION', '远程 API 必须使用 HTTPS；本机 localhost 可使用 HTTP。')
  return url
}

export class TranslationProfileStore {
  constructor(private readonly repo: LibraryRepository, private readonly secrets: SecretProtector = electronSecretProtector) {}

  private read(): StoredState {
    const builtIns = defaults()
    const raw = this.repo.setting(SETTINGS_KEY, '')
    if (!raw) return { version: 1, activeId: defaultTranslationActiveId, profiles: builtIns }
    try {
      const parsed = JSON.parse(raw) as Partial<StoredState>
      const stored = Array.isArray(parsed.profiles) ? parsed.profiles.map(cleanStoredProfile).filter((value): value is StoredProfile => !!value) : []
      const byId = new Map(stored.map((profile) => [profile.id, profile]))
      const merged = builtIns.map((preset) => {
        const saved = byId.get(preset.id)
        byId.delete(preset.id)
        return saved ? { ...preset, model: saved.model, baseUrl: saved.baseUrl, encryptedApiKey: saved.encryptedApiKey } : preset
      })
      for (const profile of byId.values()) merged.push({ ...profile, builtIn: false })
      const activeId = typeof parsed.activeId === 'string' && merged.some((profile) => profile.id === parsed.activeId)
        ? parsed.activeId : defaultTranslationActiveId
      return { version: 1, activeId, profiles: merged }
    } catch {
      return { version: 1, activeId: defaultTranslationActiveId, profiles: builtIns }
    }
  }

  private write(state: StoredState) {
    this.repo.setSetting(SETTINGS_KEY, JSON.stringify(state))
  }

  snapshot(): TranslationProfilesSnapshot {
    const state = this.read()
    return { activeId: state.activeId, profiles: state.profiles.map(publicProfile), secureStorageAvailable: this.secrets.available() }
  }

  save(input: TranslationProfileInput): TranslationProfilesSnapshot {
    const state = this.read()
    const existing = input.id ? state.profiles.find((profile) => profile.id === input.id) : undefined
    if (input.id && !existing) throw new DomainError('NOT_FOUND', '这项 API 配置已不存在，请刷新后重试。')
    const builtIn = existing?.builtIn === true
    const provider = builtIn ? existing.provider : input.provider
    const name = (builtIn ? existing.name : input.name).trim()
    const model = provider === 'siliconflowfree' ? '' : input.model.trim()
    const baseUrl = provider === 'gemini' || provider === 'siliconflowfree' ? '' : cleanBaseUrl(input.baseUrl)
    if (!name) throw new DomainError('VALIDATION', '请填写配置名称。')
    if (provider !== 'siliconflowfree' && !model) throw new DomainError('VALIDATION', '请填写模型名称。')
    let encryptedApiKey = existing?.encryptedApiKey ?? ''
    if (provider === 'siliconflowfree' || input.clearApiKey) encryptedApiKey = ''
    const apiKey = input.apiKey?.trim() ?? ''
    if (apiKey) {
      if (!this.secrets.available()) throw new DomainError('UNAVAILABLE', '当前系统无法安全保存 API 密钥，请使用免密钥服务或稍后重试。')
      encryptedApiKey = this.secrets.encrypt(apiKey)
    }
    const profile: StoredProfile = {
      id: existing?.id ?? randomUUID(), name, provider, model, baseUrl, builtIn,
      note: existing?.note ?? '自定义 API 配置；免费额度、模型可用性和数据处理规则以服务商当前说明为准。',
      encryptedApiKey
    }
    const index = existing ? state.profiles.indexOf(existing) : -1
    if (index >= 0) state.profiles[index] = profile
    else state.profiles.push(profile)
    if (state.activeId === profile.id && !profileReady(profile))
      throw new DomainError('VALIDATION', '当前正在使用此配置；请先补全密钥，或切换到其他配置后再清除。')
    this.write(state)
    return this.snapshot()
  }

  activate(id: string): TranslationProfilesSnapshot {
    const state = this.read()
    const profile = state.profiles.find((item) => item.id === id)
    if (!profile) throw new DomainError('NOT_FOUND', '这项 API 配置已不存在，请刷新后重试。')
    if (!profileReady(profile)) throw new DomainError('VALIDATION', '请先补全模型、Base URL 和 API 密钥，再设为当前配置。')
    state.activeId = id
    this.write(state)
    return this.snapshot()
  }

  delete(id: string): TranslationProfilesSnapshot {
    const state = this.read()
    const profile = state.profiles.find((item) => item.id === id)
    if (!profile) throw new DomainError('NOT_FOUND', '这项 API 配置已不存在。')
    if (profile.builtIn) throw new DomainError('VALIDATION', '内置预设不能删除，可以修改模型或复制为自定义配置。')
    state.profiles = state.profiles.filter((item) => item.id !== id)
    if (state.activeId === id) state.activeId = defaultTranslationActiveId
    this.write(state)
    return this.snapshot()
  }

  runtimeActive(): TranslationRuntimeProfile {
    const state = this.read()
    const profile = state.profiles.find((item) => item.id === state.activeId)
    if (!profile || !profileReady(profile)) throw new DomainError('VALIDATION', '当前翻译 API 配置不完整，请在文献翻译设置中补全。')
    let apiKey = ''
    if (translationProfileRequiresKey(profile.provider)) {
      if (!this.secrets.available()) throw new DomainError('UNAVAILABLE', '系统暂时无法解密 API 密钥，请重新打开应用或改用免密钥服务。')
      try { apiKey = this.secrets.decrypt(profile.encryptedApiKey) }
      catch { throw new DomainError('UNAVAILABLE', 'API 密钥无法在当前系统账户中解密，请重新填写。') }
    }
    return { id: profile.id, name: profile.name, provider: profile.provider, model: profile.model, baseUrl: profile.baseUrl, apiKey }
  }
}

