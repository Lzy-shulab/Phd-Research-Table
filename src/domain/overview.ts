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

export function parseOverviewTranslation(content: string) {
  try {
    const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    return overviewTranslationSchema.parse(JSON.parse(text))
  } catch {
    throw new DomainError('UNAVAILABLE', 'AI 未返回完整的中文题目和中文摘要，请重试。')
  }
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
