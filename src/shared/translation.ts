export const translationProviders = ['siliconflowfree', 'gemini', 'siliconflow', 'openai-compatible'] as const

export type TranslationProvider = (typeof translationProviders)[number]

export interface TranslationApiProfile {
  id: string
  name: string
  provider: TranslationProvider
  model: string
  baseUrl: string
  builtIn: boolean
  hasApiKey: boolean
  ready: boolean
  note: string
}

export interface TranslationProfileInput {
  id?: string
  name: string
  provider: TranslationProvider
  model: string
  baseUrl: string
  apiKey?: string
  clearApiKey?: boolean
}

export interface TranslationProfilesSnapshot {
  activeId: string
  profiles: TranslationApiProfile[]
  secureStorageAvailable: boolean
}

export interface TranslationRuntimeProfile {
  id: string
  name: string
  provider: TranslationProvider
  model: string
  baseUrl: string
  apiKey: string
}

export const translationProviderLabels: Record<TranslationProvider, string> = {
  siliconflowfree: 'PDF2zh 公益免费服务',
  gemini: 'Google Gemini',
  siliconflow: 'SiliconFlow',
  'openai-compatible': 'OpenAI 兼容接口'
}

export const siliconFlowTranslationModel = 'Qwen/Qwen3-8B'
export const siliconFlowTranslationBaseUrl = 'https://api.siliconflow.cn/v1'
export const defaultTranslationActiveId = 'siliconflow-api'

export const defaultTranslationProfiles: TranslationApiProfile[] = [
  {
    id: 'pdf2zh-free',
    name: 'PDF2zh 公益免费服务',
    provider: 'siliconflowfree',
    model: '',
    baseUrl: '',
    builtIn: true,
    hasApiKey: false,
    ready: true,
    note: '无需 API 密钥，使用 PDF2zh Next 的共享公益服务；高峰期可能限流或暂时不可用。'
  },
  {
    id: 'gemini-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    provider: 'gemini',
    model: 'gemini-2.5-flash-lite',
    baseUrl: '',
    builtIn: true,
    hasApiKey: false,
    ready: false,
    note: 'Google 官方免费层候选，需要自己的 Gemini API 密钥；中国大陆不在官方支持地区列表中。'
  },
  {
    id: 'openrouter-free',
    name: 'OpenRouter 免费模型路由',
    provider: 'openai-compatible',
    model: 'openrouter/free',
    baseUrl: 'https://openrouter.ai/api/v1',
    builtIn: true,
    hasApiKey: false,
    ready: false,
    note: '零价格模型会动态选择，不保证固定使用 Gemini；需要自己的 OpenRouter API 密钥，额度和可用模型会变化。'
  },
  {
    id: 'siliconflow-api',
    name: 'SiliconFlow 自有额度',
    provider: 'siliconflow',
    model: siliconFlowTranslationModel,
    baseUrl: siliconFlowTranslationBaseUrl,
    builtIn: true,
    hasApiKey: false,
    ready: false,
    note: '默认使用 Qwen/Qwen3-8B 和 SiliconFlow 官方 Chat Completions 服务；只需填写自己的 SiliconFlow API Key。'
  }
]

export function translationProfileRequiresKey(provider: TranslationProvider) {
  return provider !== 'siliconflowfree'
}
