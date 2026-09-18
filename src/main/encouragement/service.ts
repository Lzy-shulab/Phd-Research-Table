import { z } from 'zod'
import { localDay } from '../../shared/arxiv'
import { encouragementSource, localEncouragement, millisecondsToMidnight, researchQuoteIds, type DailyEncouragement, type EncouragementQuote } from '../../shared/encouragement'
import { researchFetch } from '../library/research-network'

const quoteSchema = z.object({ id: z.string().min(1).max(80), text: z.string().min(8).max(100), origin: z.string().max(200), author: z.string().max(100) })
const cacheSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), quote: quoteSchema, recentIds: z.array(z.string().max(80)).max(14) })
type QuoteCache = z.infer<typeof cacheSchema>
export interface EncouragementStorage { read: () => unknown; write: (value: QuoteCache) => void }
const plain = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\p{Cc}<>]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max) : ''
export function parseEncouragementPool(data: unknown): EncouragementQuote[] {
  if (!Array.isArray(data) || data.length > 10_000) throw new Error('鼓励语来源格式暂不可用。')
  return data.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (!researchQuoteIds.has(Number(record.id)) || typeof record.uuid !== 'string' || !/^[0-9a-f-]{36}$/i.test(record.uuid)) return []
    const quote = quoteSchema.safeParse({ id: record.uuid, text: plain(record.hitokoto, 101), origin: plain(record.from, 200), author: plain(record.from_who, 100) })
    return quote.success ? [quote.data] : []
  })
}
async function fetchPool() {
  const response = await researchFetch(encouragementSource, { signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!response.ok) throw new Error('鼓励语来源暂时无法连接。')
  const body = await response.text()
  if (body.length > 1_000_000) throw new Error('鼓励语来源响应过大。')
  return parseEncouragementPool(JSON.parse(body))
}
export class DailyEncouragementService {
  private pending?: Promise<DailyEncouragement>
  private lastAttempt = 0
  private lastAttemptDay = ''
  private timer?: ReturnType<typeof setTimeout>
  private changed?: () => void
  private paused = () => false
  constructor(private readonly storage: () => EncouragementStorage, private readonly fetcher = fetchPool, private readonly now = () => new Date()) {}
  start(changed: () => void, paused = () => false) {
    if (this.timer) return
    this.changed = changed; this.paused = paused
    const schedule = () => {
      this.timer = setTimeout(() => { void this.catchUp(); schedule() }, millisecondsToMidnight(this.now()) + 30)
      this.timer.unref()
    }
    schedule()
  }
  async catchUp() {
    if (this.paused()) return
    try { await this.get(); this.changed?.() }
    catch { /* A background refresh must not interrupt the workspace if storage is unavailable. */ }
  }
  async idle() { await this.pending }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.changed = undefined }
  async get(retry = false): Promise<DailyEncouragement> {
    const now = this.now(), date = localDay(now), storage = this.storage()
    const cached = cacheSchema.safeParse(storage.read()).data
    if (cached?.date === date) return { date, sourceDate: date, quote: cached.quote, state: 'online', message: '今日已从一言公开句库更新。' }
    if (this.pending) return this.pending
    const fallback = (): DailyEncouragement => cached
      ? { date, sourceDate: cached.date, quote: cached.quote, state: 'cached', message: `暂未连接网络，沿用 ${cached.date} 的鼓励语。` }
      : localEncouragement(date)
    if (process.env.WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO === '1') return fallback()
    if (!retry && this.lastAttemptDay === date && now.getTime() - this.lastAttempt < 15 * 60_000) return fallback()
    this.lastAttempt = now.getTime(); this.lastAttemptDay = date
    this.pending = (async () => {
      try {
        const pool = await this.fetcher()
        if (!pool.length) throw new Error('暂时没有适合的科研鼓励语。')
        const recentIds = cached?.recentIds ?? []
        const available = pool.filter((quote) => !recentIds.includes(quote.id))
        const candidates = available.length ? available : pool.filter((quote) => quote.id !== cached?.quote.id)
        const choices = candidates.length ? candidates : pool
        const dayIndex = Math.abs(Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000))
        const quote = choices[dayIndex % choices.length]!
        // A request crossing midnight belongs to its start date; the UI immediately asks for the new day.
        storage.write({ date, quote, recentIds: [...recentIds.filter((id) => id !== quote.id), quote.id].slice(-14) })
        return { date, sourceDate: date, quote, state: 'online' as const, message: '今日已从一言公开句库更新。' }
      } catch { return fallback() }
      finally { this.pending = undefined }
    })()
    return this.pending!
  }
}
