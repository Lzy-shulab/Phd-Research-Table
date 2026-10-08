import { z } from 'zod'
import { DomainError } from './errors'
import { idSchema } from './validation'

export const overviewRequestSchema = z.object({
  id: idSchema,
  sourceAbstract: z.string().trim().max(24000).optional(),
  regenerate: z.boolean().optional()
}).strict()

const chineseText = (max: number) => z.string().trim().min(1).max(max).refine((value) => /[\u3400-\u9fff]/u.test(value))
export const overviewTranslationSchema = z.object({ titleZh: chineseText(2000), abstractZh: chineseText(24000) }).strict()

export class OverviewTranslationError extends DomainError {
  constructor(message: string) { super('UNAVAILABLE', message) }
}

export function parseOverviewTranslation(content: string) {
  let value: unknown
  try {
    const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    value = JSON.parse(text)
  } catch {
    throw new OverviewTranslationError('AI 返回的中文题目与摘要格式无法解析，请重试。')
  }
  const fields = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  // Qwen can mirror the input's title/abstract keys even in JSON mode.
  // Normalize the response boundary, while keeping the stored overview schema strict.
  const titleZh = fields.titleZh ?? fields.title
  const abstractZh = fields.abstractZh ?? fields.abstract
  if (!chineseText(2000).safeParse(titleZh).success)
    throw new OverviewTranslationError('AI 回复缺少有效的中文题目，请重试。')
  if (!chineseText(24000).safeParse(abstractZh).success)
    throw new OverviewTranslationError('AI 回复缺少有效的中文摘要，请重试。')
  return overviewTranslationSchema.parse({ titleZh, abstractZh })
}

// Only accept an explicitly bounded abstract; never substitute an introduction or generated summary.
export function extractPaperAbstract(text: string): string | null {
  const start = /(?:^|\n)\s*(?:abstract|摘\s*要)\s*(?:[—–\-:：.]\s*)?/i.exec(text)
  if (!start) return null
  const body = text.slice(start.index + start[0].length)
  const end = /(?:^|\n)\s*(?:(?:index\s+terms|key\s*words)\b|关键词|(?:(?:[1I]+[.、]?\s+)?introduction)\b|(?:1[.、]?\s*)?引言)/i.exec(body)
  if (!end) return null
  const abstract = body.slice(0, end.index).replace(/([a-z])-\s*\n\s*([a-z])/g, '$1$2').replace(/\s+/g, ' ').trim()
  return abstract.length >= 40 && abstract.length <= 24000 ? abstract : null
}
