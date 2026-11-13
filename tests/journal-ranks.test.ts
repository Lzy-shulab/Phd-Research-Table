import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ safeStorage: {} }))
import { JournalRankService, parseJournalRank } from '../src/main/library/journal-ranks'
import type { LibraryRepository } from '../src/main/database/repositories/library'

const response = () => ({ code: 200, data: { officialRank: { all: { sciUp: '1区', sci: 'Q1', sciif: '8.4', ccf: 'A' } } } })
function setup() {
  const values = new Map<string, string>()
  const repo = { setting: (key: string, fallback: string) => values.get(key) ?? fallback, setSetting: (key: string, value: string) => values.set(key, value) } as unknown as LibraryRepository
  const request = vi.fn(async () => Response.json(response()))
  const service = new JournalRankService(repo, request as typeof fetch, () => {}, { available: () => true, encrypt: value => `saved:${value}`, decrypt: value => value.slice(6) })
  service.save({ secretKey: 'test-only-key', enabled: true })
  return { service, request }
}
describe('easyScholar journal ranks', () => {
  it('maps official fields without treating the query date as a partition year', () => {
    expect(parseJournalRank(response(), 'Journal').labels).toEqual([
      { name: '中科院', value: '1区' }, { name: 'JCR', value: 'Q1' }, { name: 'IF', value: '8.4' }, { name: 'CCF', value: 'A' }
    ])
    expect(parseJournalRank({ code: 200, data: null }, 'Unknown').labels).toEqual([])
    expect(() => parseJournalRank({ code: 40005, msg: '密钥不能为空', data: null }, 'Journal')).toThrow('密钥不能为空')
  })
  it('queries each journal once, caches results and skips arXiv preprints', async () => {
    const { service, request } = setup()
    await service.refresh(['Journal', '  journal ', 'arXiv', ''])
    await service.refresh(['JOURNAL'])
    expect(request).toHaveBeenCalledTimes(1)
    expect(service.snapshot().entries.journal?.labels).toHaveLength(4)
    expect(JSON.stringify(service.snapshot())).not.toContain('test-only-key')
  })
  it('retains previous labels if a refresh fails', async () => {
    const { service, request } = setup()
    await service.refresh(['Journal'])
    request.mockRejectedValueOnce(new Error('fetch failed'))
    await service.refresh(['Journal'], true)
    expect(service.snapshot().entries.journal?.labels).toHaveLength(4)
    expect(service.snapshot().error).toContain('查询未完成')
  })
})
