import { z } from 'zod'
import { DomainError } from '../../domain/errors'
import { overviewTranslationSchema } from '../../domain/overview'
import type { Paper, ArxivCandidate } from '../../shared/types'
import type { PaperOverview, PaperOverviewRequest } from '../../shared/overview'
import type { DatabaseConnection } from '../database/db'
import { LibraryRepository } from '../database/repositories/library'

const cachedSchema = overviewTranslationSchema.extend({ generatedAt: z.iso.datetime(), sourceTitle: z.string().optional(), sourceAbstract: z.string(), recordAbstract: z.string().optional() })
const cacheKey = (id: string) => `paper.overview.v1.${id}`
const resultOf = (cache: PaperOverview): PaperOverview => ({ titleZh: cache.titleZh, abstractZh: cache.abstractZh, generatedAt: cache.generatedAt, sourceAbstract: cache.sourceAbstract })

export function cachePaperOverview(repo: LibraryRepository, paper: Paper, overview: PaperOverview) {
  repo.setSetting(cacheKey(paper.id), JSON.stringify({ ...overview, sourceTitle: paper.title, recordAbstract: paper.abstract }))
}

export class PaperOverviewService {
  private pending = new Map<string, Promise<PaperOverview>>()
  constructor(private readonly connection: () => DatabaseConnection,
    private readonly translate: (title: string, abstract: string, signal?: AbortSignal) => Promise<{ titleZh: string; abstractZh: string }>,
    private readonly candidate: (id: string) => ArxivCandidate | undefined = () => undefined) {}

  generateCandidate(input: { id: string; regenerate?: boolean }, signal?: AbortSignal): Promise<PaperOverview> {
    const connection = this.connection()
    const key = JSON.stringify([connection.path, 'candidate', input.id])
    const existing = this.pending.get(key)
    if (existing) return existing
    const job = this.runCandidate(input, connection, signal).finally(() => this.pending.delete(key))
    this.pending.set(key, job)
    return job
  }
  private async runCandidate(input: { id: string; regenerate?: boolean }, connection: DatabaseConnection, signal?: AbortSignal): Promise<PaperOverview> {
    const source = this.candidate(input.id)
    if (!source) throw new DomainError('NOT_FOUND', '候选记录已变化，请重新检索或打开已收藏论文。')
    const key = `paper.overview.candidate.v1.${input.id}`
    const repo = new LibraryRepository(connection.db)
    let cached: z.infer<typeof cachedSchema> | undefined
    try { cached = cachedSchema.safeParse(JSON.parse(repo.setting(key, 'null'))).data } catch { /* A failed refresh leaves the last successful translation intact. */ }
    if (!input.regenerate) {
      if (source.overview?.sourceAbstract === source.abstract) return resultOf(source.overview)
      if (cached && (cached.sourceTitle === undefined || cached.sourceTitle === source.title) && cached.sourceAbstract === source.abstract) return resultOf(cached)
    }
    if (!source.abstract.trim()) throw new DomainError('VALIDATION', '该候选尚未提供原文摘要。')
    if (source.abstract.length > 24000) throw new DomainError('VALIDATION', '候选摘要过长，无法直接翻译。')
    signal?.throwIfAborted()
    const translated = overviewTranslationSchema.parse(await (signal ? this.translate(source.title, source.abstract, signal) : this.translate(source.title, source.abstract)))
    signal?.throwIfAborted()
    const current = this.candidate(input.id)
    if (connection !== this.connection() || !current || current.title !== source.title || current.abstract !== source.abstract)
      throw new DomainError('UNAVAILABLE', '候选内容已变化，请重新打开预览。')
    const result = { ...translated, generatedAt: new Date().toISOString(), sourceAbstract: source.abstract }
    repo.setSetting(key, JSON.stringify({ ...result, sourceTitle: source.title, recordAbstract: source.abstract }))
    return result
  }

  private cached(repo: LibraryRepository, paper: Paper) {
    try {
      const cache = cachedSchema.parse(JSON.parse(repo.setting(cacheKey(paper.id), 'null')))
      if (cache.sourceTitle === undefined) return !paper.abstract.trim() || cache.sourceAbstract === paper.abstract ? cache : null
      return cache.sourceTitle === paper.title && cache.recordAbstract === paper.abstract ? cache : null
    } catch { return null }
  }
  read(id: string): PaperOverview | null {
    const repo = new LibraryRepository(this.connection().db)
    const cache = this.cached(repo, repo.paper(id))
    return cache ? resultOf(cache) : null
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
    const paper = repo.paper(input.id)
    const cached = this.cached(repo, paper)
    if (cached && !input.regenerate) return resultOf(cached)
    let savedAbstract = ''
    try { savedAbstract = cachedSchema.parse(JSON.parse(repo.setting(cacheKey(paper.id), 'null'))).sourceAbstract } catch { /* No saved original abstract. */ }
    const sourceAbstract = paper.abstract.trim() || input.sourceAbstract?.trim() || cached?.sourceAbstract || savedAbstract
    if (!sourceAbstract) throw new DomainError('VALIDATION', '尚未取得原文摘要，请补充后翻译。')
    if (sourceAbstract.length > 24000) throw new DomainError('VALIDATION', '摘要过长，请仅提供论文的原文摘要。')
    const translated = overviewTranslationSchema.parse(await this.translate(paper.title, sourceAbstract))
    if (connection !== this.connection()) throw new DomainError('UNAVAILABLE', '数据位置已变化，请重新打开中英摘要。')
    const current = repo.paper(input.id)
    if (current.title !== paper.title || current.abstract !== paper.abstract) throw new DomainError('UNAVAILABLE', '文献信息已更新，请重新翻译摘要。')
    const result = { ...translated, generatedAt: new Date().toISOString(), sourceAbstract }
    cachePaperOverview(repo, paper, result)
    return result
  }
}
