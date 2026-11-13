import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { DomainError } from '../../domain/errors'
import { isRankedJournal, journalKey, type JournalRank, type JournalRanksSnapshot } from '../../shared/journal-ranks'
import type { LibraryRepository } from '../database/repositories/library'
import { electronSecretProtector, type SecretProtector } from './translation-profiles'

const keySetting = 'journal.easyscholar.key.v1'
const cacheSetting = 'journal.easyscholar.cache.v1'
const fields = [['sciUp', '中科院'], ['sci', 'JCR'], ['ssci', 'SSCI'], ['sciif', 'IF'], ['ccf', 'CCF']] as const
export function parseJournalRank(input: unknown, journal: string): JournalRank {
  const body = z.object({ code: z.number(), msg: z.string().optional(), data: z.unknown() }).parse(input)
  if (body.code !== 200) throw new Error(body.msg || 'easyScholar 查询失败，请检查 Secret Key 和接口额度。')
  const data = z.object({ officialRank: z.object({ all: z.record(z.string(), z.unknown()).nullish() }).nullish() }).nullish().parse(body.data)
  const all = data?.officialRank?.all ?? {}
  const labels = fields.flatMap(([field, name]) => {
    const raw = all[field]
    const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : ''
    return value && !['null', 'undefined', '-'].includes(value) ? [{ name, value }] : []
  })
  return { journal, labels, checkedAt: new Date().toISOString() }
}

export class JournalRankService {
  private entries: Record<string, JournalRank>
  private pending: Promise<JournalRanksSnapshot> | null = null
  private error = ''
  private lastStart = 0
  constructor(private readonly repo: LibraryRepository, private readonly request: typeof fetch,
    private readonly changed: () => void, private readonly secrets: SecretProtector = electronSecretProtector) {
    try { this.entries = JSON.parse(repo.setting(cacheSetting, '{}')) as Record<string, JournalRank> }
    catch { this.entries = {} }
  }
  snapshot(): JournalRanksSnapshot {
    return { enabled: this.repo.setting('journal.easyscholar.enabled', 'true') === 'true',
      configured: !!this.repo.setting(keySetting, ''), refreshing: !!this.pending, error: this.error, entries: this.entries }
  }
  save(input: { secretKey?: string; enabled: boolean; clearKey?: boolean }) {
    const key = input.secretKey?.trim()
    if (key) {
      if (!this.secrets.available()) throw new DomainError('UNAVAILABLE', '当前系统无法保存密钥，请稍后重试。')
      this.repo.setSetting(keySetting, this.secrets.encrypt(key))
    } else if (input.clearKey) this.repo.setSetting(keySetting, '')
    this.repo.setSetting('journal.easyscholar.enabled', String(input.enabled))
    this.error = ''; this.changed()
    return this.snapshot()
  }
  async refresh(journals: string[], force = false): Promise<JournalRanksSnapshot> {
    if (this.pending) await this.pending
    if (!this.snapshot().enabled || !this.snapshot().configured) return this.snapshot()
    const names = [...new Map(journals.filter(isRankedJournal).map(name => [journalKey(name), name.trim()])).values()]
      .filter(name => force || !this.entries[journalKey(name)] || Date.now() - Date.parse(this.entries[journalKey(name)]!.checkedAt) > 30 * 86400000)
    if (!names.length) return this.snapshot()
    this.error = ''
    this.pending = (async () => {
      try {
        const secretKey = this.secrets.decrypt(this.repo.setting(keySetting, ''))
        for (const name of names) {
          await delay(Math.max(0, 600 - (Date.now() - this.lastStart)))
          const url = new URL('https://www.easyscholar.cc/open/getPublicationRank')
          url.searchParams.set('secretKey', secretKey); url.searchParams.set('publicationName', name)
          this.lastStart = Date.now()
          const response = await this.request(url.href, { signal: AbortSignal.timeout(20000), cache: 'no-store' })
          if (!response.ok) throw new Error(response.status === 429 ? 'easyScholar 查询过于频繁，请稍后刷新。' : 'easyScholar 暂时无法连接，请稍后刷新。')
          this.entries[journalKey(name)] = parseJournalRank(await response.json(), name)
          this.repo.setSetting(cacheSetting, JSON.stringify(this.entries)); this.changed()
        }
      } catch (error) {
        // Never expose request URLs, which carry the service's required query credential.
        this.error = error instanceof Error && !/https?:|fetch|decrypt/i.test(error.message)
          ? error.message.slice(0, 240) : 'easyScholar 查询未完成，请检查连接或重新填写 Secret Key。'
      }
      return this.snapshot()
    })().finally(() => { this.pending = null; this.changed() })
    this.changed()
    await this.pending
    return this.snapshot()
  }
}
