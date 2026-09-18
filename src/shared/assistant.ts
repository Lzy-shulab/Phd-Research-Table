import type { Task } from './types'

export const assistantProviders = ['siliconflow', 'openrouter', 'custom'] as const
export type AssistantProvider = (typeof assistantProviders)[number]
export interface AssistantProfile {
  provider: AssistantProvider
  model: string
  baseUrl: string
  hasApiKey: boolean
}
export interface AssistantSettings {
  activeProvider: AssistantProvider
  quickRecognitionEnabled: boolean
  profiles: AssistantProfile[]
}
export interface AssistantSettingsInput {
  provider: AssistantProvider
  model: string
  baseUrl: string
  apiKey?: string
  clearApiKey?: boolean
}
export interface AssistantRequest {
  requestId: string
  text: string
  projectId: string | null
}
export interface AssistantResult {
  kind: 'created' | 'clarify' | 'unsupported'
  message: string
  tasks: Task[]
}

export const siliconFlowAssistantModel = 'Qwen/Qwen3-8B'
export const siliconFlowAssistantEndpoint = 'https://api.siliconflow.cn/v1/chat/completions'
export const defaultAssistantActiveProvider = 'siliconflow' satisfies AssistantProvider
export const defaultAssistantProfiles: Omit<AssistantProfile, 'hasApiKey'>[] = [
  { provider: 'siliconflow', model: siliconFlowAssistantModel, baseUrl: siliconFlowAssistantEndpoint },
  { provider: 'openrouter', model: 'openrouter/free', baseUrl: 'https://openrouter.ai/api/v1' },
  { provider: 'custom', model: '', baseUrl: '' }
]
export const assistantProviderLabels: Record<AssistantProvider, string> = {
  siliconflow: 'SiliconFlow',
  openrouter: 'OpenRouter 免费',
  custom: '自定义 API'
}
export function assistantProfileRequiresKey(provider: AssistantProvider) {
  return provider !== 'custom'
}
