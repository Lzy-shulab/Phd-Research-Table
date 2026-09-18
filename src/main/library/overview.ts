import { createHash } from 'node:crypto'
import { z } from 'zod'
import { DomainError } from '../../domain/errors'
import { overviewTranslationSchema } from '../../domain/overview'
import type { Paper } from '../../shared/types'
import type { PaperOverview, PaperOverviewRequest } from '../../shared/overview'
import type { DatabaseConnection } from '../database/db'
import { LibraryRepository } from '../database/repositories/library'

const cachedSchema = overviewTranslationSchema.extend({ generatedAt: z.iso.datetime(), fingerprint: z.string(), sourceAbstract: z.string() })
const fingerprint = (paper: Paper) => createHash('sha256').update(JSON.stringify([paper.title, paper.abstract, paper.sha256])).digest('hex')
const cacheKey = (id: string) => `paper.overview.v1.${id}`

export class PaperOverviewService {
  private pending = new Map<string, Promise<PaperOverview>>()
  constructor(private readonly connection: () => DatabaseConnection,
    private readonly translate: (title: string, abstract: string) => Promise<{ titleZh: string; abstractZh: string }>) {}

  private cached(repo: LibraryRepository, paper: Paper) {
    try {
      const cache = cachedSchema.parse(JSON.parse(repo.setting(cacheKey(paper.id), 'null')))
      return cache.fingerprint === fingerprint(paper) ? cache : null
    } catch { return null }
  }
  read(id: string): PaperOverview | null {
    const repo = new LibraryRepository(this.connection().db)
    const cache = this.cached(repo, repo.paper(id))
    return cache ? { titleZh: cache.titleZh, abstractZh: cache.abstractZh, generatedAt: cache.generatedAt, sourceAbstract: cache.sourceAbstract } : null
  }
  generate(input: PaperOverviewRequest): Promise<PaperOverview> {
    const connection = this.connection()
    const key = JSON.stringify([connection.path, input.id])
    const existing = this.pending.get(key)
    if (existing) return existing
    const job = this.run(input, connection).finally(() => this.pending.delete(key))
    this.pending.set(key, job)
    return job
  }
  private async run(input: PaperOverviewRequest, connection: DatabaseConnection): Promise<PaperOverview> {
    const repo = new LibraryRepository(connection.db)
    const paper = repo.paper(input.id), hash = fingerprint(paper)
    const cached = this.cached(repo, paper)
    if (cached && !input.regenerate) return { titleZh: cached.titleZh, abstractZh: cached.abstractZh, generatedAt: cached.generatedAt, sourceAbstract: cached.sourceAbstract }
    const sourceAbstract = paper.abstract.trim() || input.sourceAbstract?.trim() || cached?.sourceAbstract || ''
    if (!sourceAbstract) throw new DomainError('VALIDATION', '尚未取得原文摘要，请补充后翻译。')
    if (sourceAbstract.length > 24000) throw new DomainError('VALIDATION', '摘要过长，请仅提供论文的原文摘要。')
    const translated = overviewTranslationSchema.parse(await this.translate(paper.title, sourceAbstract))
    if (connection !== this.connection()) throw new DomainError('UNAVAILABLE', '数据位置已变化，请重新打开中英摘要。')
    if (fingerprint(repo.paper(input.id)) !== hash) throw new DomainError('UNAVAILABLE', '文献信息已更新，请重新翻译摘要。')
    const result = { ...translated, generatedAt: new Date().toISOString(), sourceAbstract }
    repo.setSetting(cacheKey(input.id), JSON.stringify({ ...result, fingerprint: hash, sourceAbstract }))
    return result
  }
}
