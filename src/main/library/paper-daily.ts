import { shell } from 'electron'
import { z } from 'zod'
import { DomainError } from '../../domain/errors'
import { localDay } from '../../shared/arxiv'
import type { DailyPaper, PaperDailySnapshot } from '../../shared/paper-daily'
import type { ArxivSettings, Paper } from '../../shared/types'
import type { LibraryRepository } from '../database/repositories/library'
import { directionTerms, matchesDailySearch, relevance, relevanceReasons } from './arxiv'
import { researchFetch } from './research-network'

type SourcePaper = Omit<DailyPaper, 'matchReason' | 'favorite' | 'paperId'>
const savedKey = 'paper-daily.entries.v1'
const ignoredKey = 'paper-daily.ignored.v1'
const lastRunKey = 'paper-daily.lastRun'
const text = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const titleKey = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const arxivIdSchema = z.string().regex(/^\d{4}\.\d{4,5}(?:v\d+)?$/)
const pdfHosts = new Set(['openaccess.thecvf.com', 'aclanthology.org', 'proceedings.mlr.press', 'jmlr.org'])
function openPdfLink(raw: string) {
  try {
    const url = new URL(raw)
    if (url.protocol === 'https:' && pdfHosts.has(url.hostname) && /\.pdf$/i.test(url.pathname)) return url.href
  } catch { /* A DOI landing page is still available. */ }
}
const huggingFaceEntry = z.object({ paper: z.object({
  id: arxivIdSchema, title: z.string(), summary: z.string().optional(), publishedAt: z.string(),
  authors: z.array(z.object({ name: z.string() })).optional()
}) })
const crossrefEntry = z.object({
  DOI: z.string().regex(/^10\.\d{4,9}\/\S+$/), title: z.array(z.string()).min(1), abstract: z.string().optional(),
  'container-title': z.array(z.string()).optional(),
  link: z.array(z.object({ URL: z.string() })).optional(),
  published: z.object({ 'date-parts': z.array(z.array(z.number().int()).min(3)).min(1) }),
  author: z.array(z.object({ given: z.string().optional(), family: z.string().optional(), name: z.string().optional() })).optional()
})

export function rankDailyPapers(entries: SourcePaper[], settings: ArxivSettings, from: string, today: string) {
  const titles = new Set<string>()
  return entries.filter(entry => entry.publishedDate >= from && entry.publishedDate <= today && matchesDailySearch(entry, settings))
    .sort((a, b) => relevance(b, settings.directions) - relevance(a, settings.directions) ||
      b.publishedDate.localeCompare(a.publishedDate) || a.title.localeCompare(b.title))
    .filter(entry => {
      const key = titleKey(entry.title)
      if (titles.has(key)) return false
      titles.add(key)
      return true
    }).slice(0, settings.maxPerDay)
}

export class PaperDailyService {
  private entries: DailyPaper[]
  private ignored: string[]
  private controller?: AbortController
  private readonly downloads = new Map<string, AbortController>()
  private timer?: ReturnType<typeof setInterval>
  private stopped = false
  private message = ''
  constructor(private readonly repo: LibraryRepository, private readonly settings: () => ArxivSettings,
    private readonly save: (paper: DailyPaper, bytes: Buffer) => Promise<Paper>, private readonly changed: () => void,
    private readonly fetcher = researchFetch) {
    this.entries = this.read<DailyPaper>(savedKey)
    this.ignored = this.read<string>(ignoredKey)
  }
  private read<T>(key: string): T[] {
    try {
      const value: unknown = JSON.parse(this.repo.setting(key, '[]'))
      if (Array.isArray(value)) return value as T[]
    } catch { /* Start with an empty list if a saved list is unreadable. */ }
    return []
  }
  private persist() {
    this.repo.setSetting(savedKey, JSON.stringify(this.entries))
    this.changed()
  }
  snapshot(): PaperDailySnapshot {
    return { entries: this.entries, running: !!this.controller, downloading: [...this.downloads.keys()],
      lastRun: this.repo.setting(lastRunKey, ''), message: this.message }
  }
  busy() { return !!this.controller || this.downloads.size > 0 }
  startAutomatic() {
    if (this.timer || this.stopped) return
    const check = () => {
      if (!this.settings().enabled || this.busy()) return
      const day = localDay()
      if (this.repo.setting('paper-daily.lastAutomaticDay', '') === day) return
      this.repo.setSetting('paper-daily.lastAutomaticDay', day)
      this.start()
    }
    this.timer = setInterval(check, 60_000)
    this.timer.unref()
    check()
  }
  start() {
    if (this.controller || this.stopped) return
    const controller = this.controller = new AbortController()
    this.message = '正在检索 Hugging Face 和 Crossref…'
    this.changed()
    void this.search(controller.signal).catch((error: unknown) => {
      if (!this.stopped) this.message = controller.signal.aborted ? '检索已停止。' : error instanceof Error ? error.message : '检索失败。'
    }).finally(() => {
      this.controller = undefined
      if (!this.stopped) this.changed()
    })
  }
  cancel() { this.controller?.abort() }
  stop() {
    this.stopped = true
    clearInterval(this.timer)
    this.cancel()
    for (const controller of this.downloads.values()) controller.abort()
  }
  private async response(url: string, signal: AbortSignal, seconds = 18) {
    const response = await this.fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(seconds * 1000)]),
      headers: { 'User-Agent': 'PhD-Research-Workbench/0.8.60' } })
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`HTTP ${response.status}`)
    }
    return response
  }
  private async huggingFace(week: string, signal: AbortSignal): Promise<SourcePaper[]> {
    const response = await this.response(`https://huggingface.co/api/daily_papers?week=${week}&limit=100`, signal)
    const results = z.array(z.unknown()).parse(await response.json())
    return results.flatMap(result => {
      const entry = huggingFaceEntry.safeParse(result).data?.paper
      if (!entry) return []
      const id = entry.id.replace(/v\d+$/, '')
      return [{ id: `arxiv:${id}`, arxivId: id, title: text(entry.title), authors: entry.authors?.map(author => author.name).join(', ') ?? '',
        abstract: text(entry.summary ?? ''), publishedDate: entry.publishedAt.slice(0, 10), journal: 'arXiv', doi: '',
        source: 'Hugging Face', url: `https://huggingface.co/papers/${id}` }]
    })
  }
  private async crossref(direction: string, from: string, to: string, signal: AbortSignal): Promise<SourcePaper[]> {
    const params = new URLSearchParams({
      'query.bibliographic': directionTerms(direction).join(' '), rows: '20',
      filter: `from-pub-date:${from},until-pub-date:${to},type:journal-article,type:proceedings-article`
    })
    const response = await this.response(`https://api.crossref.org/works?${params}`, signal)
    const results = z.object({ message: z.object({ items: z.array(z.unknown()) }) }).parse(await response.json()).message.items
    return results.flatMap(result => {
      const entry = crossrefEntry.safeParse(result).data
      if (!entry) return []
      const date = entry.published['date-parts'][0]!.slice(0, 3).map(part => String(part).padStart(2, '0')).join('-')
      const doi = entry.DOI.toLowerCase()
      return [{ id: `doi:${doi}`, doi, title: text(entry.title[0]!), journal: text(entry['container-title']?.[0] ?? ''),
        authors: entry.author?.map(author => author.name || [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean).join(', ') ?? '',
        abstract: text(entry.abstract ?? '').replace(/^Abstract\s+/i, ''), publishedDate: date,
        pdfUrl: entry.link?.map(link => openPdfLink(link.URL)).find(Boolean),
        source: 'Crossref', url: `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}` }]
    })
  }
  private async search(signal: AbortSignal) {
    const settings = this.settings(), now = new Date(), today = localDay(now)
    const first = new Date(now)
    first.setDate(first.getDate() - settings.daysBack + 1)
    const from = localDay(first)
    const weeks = new Set<string>()
    for (const day = new Date(first); day <= now; day.setDate(day.getDate() + 1)) {
      const thursday = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()))
      thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7))
      const year = thursday.getUTCFullYear(), week = Math.ceil(((+thursday - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7)
      weeks.add(`${year}-W${String(week).padStart(2, '0')}`)
    }
    const found = new Map<string, SourcePaper>()
    let successful = 0
    const failures = new Set<string>()
    const queries = [
      ...[...weeks].map(week => ({ source: 'Hugging Face', fetch: () => this.huggingFace(week, signal) })),
      ...settings.directions.map(direction => ({ source: 'Crossref', fetch: () => this.crossref(direction, from, today, signal) }))
    ]
    const fetchNext = async () => {
      while (queries.length && !signal.aborted) {
        const query = queries.shift()!
        try {
          for (const entry of await query.fetch()) if (entry.title) found.set(entry.id, entry)
          successful++
        } catch { failures.add(query.source) }
      }
    }
    await Promise.all(Array.from({ length: 4 }, fetchNext))
    signal.throwIfAborted()
    if (!successful) throw Error('Hugging Face 和 Crossref 暂时无法连接，请稍后重试。')
    const keep = this.entries.filter(entry => entry.favorite || entry.paperId || this.downloads.has(entry.id))
    const excluded = new Set([...this.ignored, ...keep.map(entry => titleKey(entry.title))])
    const candidates = rankDailyPapers([...found.values()].filter(entry => !excluded.has(titleKey(entry.title))), settings, from, today)
      .map(entry => ({ ...entry, favorite: false, matchReason: relevanceReasons(entry, settings.directions).join('；') }))
    this.entries = [...candidates, ...keep]
    this.repo.setSetting(lastRunKey, new Date().toISOString())
    this.message = `找到 ${candidates.length} 篇待筛选论文${failures.size ? ` · ${[...failures].join('、')} 有请求未完成` : ''}`
    this.persist()
  }
  async action(id: string, action: 'favorite' | 'ignore' | 'open' | 'download') {
    const entry = this.entries.find(item => item.id === id)
    if (!entry) throw new DomainError('NOT_FOUND', '这篇论文已不在 Paper Daily 列表中。')
    if (action === 'open') { await shell.openExternal(entry.url); return }
    if (action === 'favorite') {
      entry.favorite = !entry.favorite
      this.persist()
      if (!entry.favorite || entry.paperId) return
    }
    if (action === 'ignore') {
      if (this.downloads.has(id)) throw new DomainError('VALIDATION', '请等待当前 PDF 下载完成。')
      this.ignored = [...new Set([...this.ignored, titleKey(entry.title)])].slice(-2000)
      this.repo.setSetting(ignoredKey, JSON.stringify(this.ignored))
      this.entries = this.entries.filter(item => item.id !== id)
      this.persist()
      return
    }
    const url = entry.arxivId && arxivIdSchema.safeParse(entry.arxivId).success
      ? `https://arxiv.org/pdf/${entry.arxivId}` : entry.pdfUrl && openPdfLink(entry.pdfUrl)
    if (!url || this.downloads.has(id)) return
    const controller = new AbortController()
    this.downloads.set(id, controller)
    this.changed()
    try {
      const response = await this.response(url, controller.signal, 90)
      const reader = response.body?.getReader(), chunks: Uint8Array[] = []
      if (!reader) throw Error('PDF 内容为空。')
      let size = 0
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 100 * 1024 * 1024) { await reader.cancel(); throw Error('PDF 超过 100 MB。') }
        chunks.push(chunk.value)
      }
      const bytes = Buffer.concat(chunks)
      if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw Error('来源返回的内容不是 PDF。')
      controller.signal.throwIfAborted()
      entry.paperId = (await this.save(entry, bytes)).id
      if (!this.stopped) this.persist()
    } catch (error) {
      throw new DomainError('UNAVAILABLE', `PDF 下载失败，已保留论文标题和来源链接。 ${error instanceof Error ? error.message : ''}`)
    } finally {
      this.downloads.delete(id)
      if (!this.stopped) this.changed()
    }
  }
}
