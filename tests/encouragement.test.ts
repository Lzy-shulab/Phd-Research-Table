import { afterEach, describe, expect, it, vi } from 'vitest'
import { DailyEncouragementService, parseEncouragementPool } from '../src/main/encouragement/service'
import { localEncouragement, millisecondsToMidnight, type EncouragementQuote } from '../src/shared/encouragement'

vi.mock('electron', () => ({ session: {} }))
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })
const quotes: EncouragementQuote[] = [
  { id: 'one', text: '把今天的问题问清楚，就是研究向前的一步。', origin: '验收来源', author: '' },
  { id: 'two', text: '给自己一点时间，把一个小问题做扎实。', origin: '验收来源', author: '' },
  { id: 'three', text: '保持好奇，也允许自己慢一点理解。', origin: '验收来源', author: '' }
]
function fixture(fetcher = vi.fn(async () => quotes)) {
  let data: unknown, now = new Date(2026, 8, 8, 23, 59, 59)
  const storage = () => ({ read: () => data, write: (value: unknown) => { data = value } })
  return { service: new DailyEncouragementService(storage, fetcher, () => now), fetcher, storage, advance: (date: Date) => { now = date } }
}
describe('Daily network encouragement', () => {
  it('fetches once per date, coalesces requests, survives restart and chooses a different sentence the next day', async () => {
    const f = fixture()
    const [first, concurrent] = await Promise.all([f.service.get(), f.service.get()])
    expect(first.state).toBe('online'); expect(concurrent.quote).toEqual(first.quote); expect(f.fetcher).toHaveBeenCalledTimes(1)
    expect((await f.service.get(true)).quote).toEqual(first.quote); expect(f.fetcher).toHaveBeenCalledTimes(1)
    const restarted = new DailyEncouragementService(f.storage, f.fetcher, () => new Date(2026, 8, 8, 23, 59, 59))
    expect((await restarted.get()).quote).toEqual(first.quote); expect(f.fetcher).toHaveBeenCalledTimes(1)
    f.advance(new Date(2026, 8, 9, 0, 0, 0))
    const next = await f.service.get()
    expect(next.date).toBe('2026-09-09'); expect(next.quote.id).not.toBe(first.quote.id); expect(f.fetcher).toHaveBeenCalledTimes(2)
  })
  it('retains the previous source date offline, retries with a throttle, and recovers on the same day', async () => {
    const f = fixture(), first = await f.service.get()
    f.advance(new Date(2026, 8, 9, 0, 0, 0)); f.fetcher.mockRejectedValue(new Error('offline'))
    const offline = await f.service.get()
    expect(offline).toMatchObject({ state: 'cached', date: '2026-09-09', sourceDate: '2026-09-08', quote: first.quote })
    await f.service.get(); expect(f.fetcher).toHaveBeenCalledTimes(2)
    f.fetcher.mockResolvedValue(quotes)
    expect((await f.service.get(true)).state).toBe('online'); expect(f.fetcher).toHaveBeenCalledTimes(3)
  })
  it('uses an explicitly local sentence on first-run failure and can disable network in unrelated tests', async () => {
    const f = fixture(vi.fn(async () => { throw new Error('offline') }))
    const local = await f.service.get()
    expect(local.state).toBe('local'); expect(local.quote.origin).toBe('工作台原创')
    expect(local.quote.text).toBe(localEncouragement('2026-09-08').quote.text)
    vi.stubEnv('WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO', '1')
    const disabled = fixture(); expect((await disabled.service.get()).state).toBe('local'); expect(disabled.fetcher).not.toHaveBeenCalled()
  })
  it('limits external content to reviewed topics and plain, bounded strings', () => {
    expect(parseEncouragementPool([{ id: 6477, uuid: '0a97af92-1467-4fa5-897d-426fc94a7fcc', hitokoto: '实践是检验真理的唯一标准。', from: '来源', from_who: null },
      { id: 1, uuid: '0a97af92-1467-4fa5-897d-426fc94a7fcc', hitokoto: '不相关内容不会进入每日科研。' },
      { id: 6477, uuid: 'invalid', hitokoto: '格式错误也不会采用。' }])).toHaveLength(1)
    expect(() => parseEncouragementPool({ error: 'unavailable' })).toThrow()
  })
  it('schedules the next local midnight including month and year transitions', () => {
    expect(millisecondsToMidnight(new Date(2026, 8, 8, 23, 59, 59, 500))).toBe(500)
    expect(millisecondsToMidnight(new Date(2026, 11, 31, 23, 59, 50))).toBe(10_000)
    expect(millisecondsToMidnight(new Date(2026, 8, 9, 0, 0, 0))).toBe(86_400_000)
  })
  it('updates in the background at midnight, catches up after resume, and waits before relocating storage', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 8, 23, 59, 59))
    const f = fixture(), changed = vi.fn()
    let paused = false
    const service = new DailyEncouragementService(f.storage, f.fetcher)
    await service.get(); service.start(changed, () => paused)
    await vi.advanceTimersByTimeAsync(1100)
    expect(f.fetcher).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date(2026, 8, 11, 8)); paused = true
    await service.catchUp(); expect(f.fetcher).toHaveBeenCalledTimes(2)
    paused = false; await service.catchUp(); await service.idle()
    expect((await service.get()).date).toBe('2026-09-11'); expect(f.fetcher).toHaveBeenCalledTimes(3)
    service.stop(); expect(vi.getTimerCount()).toBe(0)
  })
})
