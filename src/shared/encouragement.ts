import { localDay } from './arxiv'

export interface EncouragementQuote {
  id: string
  text: string
  origin: string
  author: string
}
export interface DailyEncouragement {
  date: string
  sourceDate: string
  quote: EncouragementQuote
  state: 'online' | 'cached' | 'local'
  message: string
}
export const encouragementSource = 'https://sentences-bundle.hitokoto.cn/sentences/k.json'
export const encouragementSourcePage = 'https://sentences-bundle.hitokoto.cn/'
// Reviewed topic choices: learning, scientific thinking and steady progress.
// Only IDs are shipped; the original wording and attribution are read from the source each day.
export const researchQuoteIds = new Set([5021, 6175, 6256, 6477, 7081, 7256, 7316, 7458, 7483, 8063, 8563, 8997, 9083, 9543, 9624, 10221])
const localEncouragements = [
  '把今天的问题问清楚，就是研究向前的一步。',
  '暂时没有答案也没关系，认真记录会让下一次尝试更有方向。',
  '给自己一点时间，把一个小问题做扎实。',
  '保持好奇，也允许自己慢一点理解。',
  '今天读懂的一段、验证的一点，都会成为后续研究的基础。',
  '一次不符合预期的结果，也能帮助你排除一个方向。',
  '照顾好自己，才能持续地做你在意的研究。'
]
export function localEncouragement(date = localDay()): DailyEncouragement {
  const index = Math.abs(Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)) % localEncouragements.length
  return { date, sourceDate: date, quote: { id: '', text: localEncouragements[index]!, origin: '工作台原创', author: '' }, state: 'local', message: '暂用本地鼓励语，联网后自动更新。' }
}
export function millisecondsToMidnight(now: Date) {
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0)
  return Math.max(1, midnight.getTime() - now.getTime())
}
