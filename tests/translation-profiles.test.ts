import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '' },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() }
}))

import { openDatabase, type DatabaseConnection } from '../src/main/database/db'
import { LibraryRepository } from '../src/main/database/repositories/library'
import { TranslationProfileStore, type SecretProtector } from '../src/main/library/translation-profiles'
import { applyTranslationProfileConfig, translatorExecutable } from '../src/main/library/translator'

const resources: { directory: string; connection: DatabaseConnection }[] = []
const protector: SecretProtector = {
  available: () => true,
  encrypt: (value) => Buffer.from(`protected:${value}`).toString('base64'),
  decrypt: (value) => Buffer.from(value, 'base64').toString('utf8').replace(/^protected:/, '')
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'translation-profiles-'))
  const connection = openDatabase(join(directory, 'workbench.sqlite'), resolve('src/main/database/migrations'))
  resources.push({ directory, connection })
  return { connection, store: new TranslationProfileStore(new LibraryRepository(connection.db), protector) }
}

afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.connection.close(); rmSync(resource.directory, { recursive: true, force: true })
  }
})

describe('Translation API profiles', () => {
  it('starts with four presets and defaults to SiliconFlow Qwen until the user adds a key', () => {
    const { store } = setup()
    const snapshot = store.snapshot()
    expect(snapshot.activeId).toBe('siliconflow-api')
    expect(snapshot.profiles).toHaveLength(4)
    expect(snapshot.profiles.find((profile) => profile.id === 'pdf2zh-free')).toMatchObject({ ready: true, hasApiKey: false })
    expect(snapshot.profiles.find((profile) => profile.id === 'siliconflow-api')).toMatchObject({ model: 'Qwen/Qwen3-8B', baseUrl: 'https://api.siliconflow.cn/v1', ready: false })
    expect(snapshot.profiles.find((profile) => profile.id === 'gemini-flash-lite')).toMatchObject({ model: 'gemini-2.5-flash-lite', ready: false })
    expect(() => store.activate('gemini-flash-lite')).toThrow('补全')
  })

  it('completes and activates the built-in Gemini Flash-Lite profile without exposing its key', () => {
    const { store } = setup()
    const saved = store.save({ id: 'gemini-flash-lite', name: 'ignored preset rename', provider: 'gemini', model: 'gemini-2.5-flash-lite', baseUrl: '', apiKey: 'gemini-test-key' })
    expect(saved.profiles.find((profile) => profile.id === 'gemini-flash-lite')).toMatchObject({ name: 'Gemini 2.5 Flash-Lite', ready: true, hasApiKey: true })
    expect(JSON.stringify(saved)).not.toContain('gemini-test-key')
    store.activate('gemini-flash-lite')
    expect(store.runtimeActive()).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-flash-lite', apiKey: 'gemini-test-key' })
  })

  it('encrypts custom keys at rest, never returns plaintext, and resolves only the active runtime profile', () => {
    const { connection, store } = setup()
    const saved = store.save({ name: 'My free endpoint', provider: 'openai-compatible', model: 'router/free', baseUrl: 'https://example.test/v1/', apiKey: 'private-test-key' })
    const custom = saved.profiles.at(-1)!
    expect(custom).toMatchObject({ name: 'My free endpoint', baseUrl: 'https://example.test/v1', hasApiKey: true, ready: true })
    expect(JSON.stringify(saved)).not.toContain('private-test-key')
    const stored = connection.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'translation.profiles.v1'").get() as { value: string }
    expect(stored.value).not.toContain('private-test-key')
    store.activate(custom.id)
    expect(store.runtimeActive()).toMatchObject({ id: custom.id, apiKey: 'private-test-key', model: 'router/free' })
    expect(() => store.save({ id: custom.id, name: custom.name, provider: custom.provider, model: custom.model, baseUrl: custom.baseUrl, clearApiKey: true })).toThrow('当前正在使用')
    store.activate('pdf2zh-free')
    expect(store.delete(custom.id).profiles.some((profile) => profile.id === custom.id)).toBe(false)
  })

  it('rejects unsafe or completion-suffixed remote endpoints', () => {
    const { store } = setup()
    const base = { name: 'Bad endpoint', provider: 'openai-compatible' as const, model: 'free', apiKey: 'key' }
    expect(() => store.save({ ...base, baseUrl: 'http://example.test/v1' })).toThrow('HTTPS')
    expect(() => store.save({ ...base, baseUrl: 'https://example.test/v1/chat/completions' })).toThrow('不要包含')
  })
})

describe('PDF2zh per-job configuration', () => {
  const template = `siliconflowfree = false
gemini = false
siliconflow = true
openaicompatible = false

[siliconflowfree_detail]
translate_engine_type = "SiliconFlowFree"

[siliconflow_detail]
siliconflow_base_url = "https://old.test/v1"
siliconflow_model = "old-model"
siliconflow_api_key = "old-secret"

[gemini_detail]
gemini_model = "old-gemini"
gemini_api_key = "old-gemini-secret"

[openaicompatible_detail]
openai_compatible_model = "old-compatible"
openai_compatible_base_url = "https://old-compatible.test/v1"
openai_compatible_api_key = "old-compatible-secret"
`

  it('selects OpenAI-compatible free routing and strips every unrelated template secret', () => {
    const output = applyTranslationProfileConfig(template, { id: 'custom', name: 'Router', provider: 'openai-compatible', model: 'openrouter/free', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'selected-key' })
    expect(output).toContain('openaicompatible = true')
    expect(output).toContain('siliconflow = false')
    expect(output).toContain('openai_compatible_model = "openrouter/free"')
    expect(output).toContain('openai_compatible_base_url = "https://openrouter.ai/api/v1"')
    expect(output).toContain('openai_compatible_api_key = "selected-key"')
    expect(output).not.toContain('old-secret')
    expect(output).not.toContain('old-gemini-secret')
    expect(output).not.toContain('old-compatible-secret')
  })

  it('applies every built-in provider safely to the bundled 2.9.0 configuration schema', () => {
    const bundled = readFileSync(resolve('resources/pdf2zh-config.toml.example'), 'utf8')
    const profiles = [
      { id: 'free', name: 'Free', provider: 'siliconflowfree' as const, model: '', baseUrl: '', apiKey: '' },
      { id: 'gemini', name: 'Gemini', provider: 'gemini' as const, model: 'gemini-2.5-flash-lite', baseUrl: '', apiKey: 'selected-key' },
      { id: 'silicon', name: 'Silicon', provider: 'siliconflow' as const, model: 'model', baseUrl: 'https://api.example/v1', apiKey: 'selected-key' },
      { id: 'compatible', name: 'Compatible', provider: 'openai-compatible' as const, model: 'model', baseUrl: 'https://api.example/v1', apiKey: 'selected-key' }
    ]
    for (const profile of profiles) {
      const output = applyTranslationProfileConfig(bundled, profile)
      const selected = profile.provider === 'openai-compatible' ? 'openaicompatible' : profile.provider
      expect(output).toMatch(new RegExp(`^${selected} = true$`, 'm'))
      expect(output.match(/^siliconflowfree = true$/gm)?.length ?? 0).toBe(selected === 'siliconflowfree' ? 1 : 0)
      expect(output).not.toMatch(/(?:api_key|apikey|auth_key|secret_id|secret_key|access_token)\s*=\s*"(?!null|selected-key)/i)
    }
  })

  it('selects the keyless PDF2zh free service without carrying any API key', () => {
    const output = applyTranslationProfileConfig(template, { id: 'pdf2zh-free', name: 'Free', provider: 'siliconflowfree', model: '', baseUrl: '', apiKey: '' })
    expect(output).toContain('siliconflowfree = true')
    expect(output).toContain('gemini = false')
    expect(output).not.toMatch(/api_key\s*=\s*"(?!null)/)
  })

  it('writes the current Gemini Flash-Lite model into the Gemini section only', () => {
    const output = applyTranslationProfileConfig(template, { id: 'gemini-flash-lite', name: 'Gemini', provider: 'gemini', model: 'gemini-2.5-flash-lite', baseUrl: '', apiKey: 'gemini-key' })
    expect(output).toContain('gemini = true')
    expect(output).toContain('siliconflowfree = false')
    expect(output).toContain('gemini_model = "gemini-2.5-flash-lite"')
    expect(output).toContain('gemini_api_key = "gemini-key"')
    expect(output).not.toContain('old-secret')
    expect(output).not.toContain('old-compatible-secret')
  })

  it('recognizes both the legacy virtual environment and the official portable Windows layout', () => {
    const directory = mkdtempSync(join(tmpdir(), 'translation-layout-'))
    try {
      const portable = join(directory, 'pdf2zh'); mkdirSync(portable)
      writeFileSync(join(portable, 'pdf2zh_next.exe'), 'portable')
      expect(translatorExecutable(directory)).toBe(join(portable, 'pdf2zh_next.exe'))
      rmSync(portable, { recursive: true, force: true })
      const scripts = join(directory, 'zotero-pdf2zh-next-venv', 'Scripts'); mkdirSync(scripts, { recursive: true })
      writeFileSync(join(scripts, 'pdf2zh_next.exe'), 'legacy')
      expect(translatorExecutable(directory)).toBe(join(scripts, 'pdf2zh_next.exe'))
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
