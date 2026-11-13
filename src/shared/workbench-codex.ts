import type { CodexReasoningEffort, CodexTranslationStatus } from './translation'

export const defaultWorkbenchModel = 'gpt-6.1-terra'
export const defaultWorkbenchEffort = 'high' as const
export interface WorkbenchCodexInput { id: string; text: string; model: string; effort: CodexReasoningEffort }
export type WorkbenchCodexModel = CodexTranslationStatus['models'][number]
export type WorkbenchCodexEvent =
  | { id: string; kind: 'delta'; itemId: string; text: string }
  | { id: string; kind: 'message'; itemId: string; text: string }
  | { id: string; kind: 'action'; itemId: string; phase: 'running' | 'done' | 'failed'; text: string; detail?: string }
